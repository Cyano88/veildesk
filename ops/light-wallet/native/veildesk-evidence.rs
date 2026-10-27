//! Read-only, scoped evidence exporter. Built inside the pinned zingolib workspace.
//! Reads one stopped-wallet snapshot and one bounded JSON query from stdin. Never sends funds.
use std::io::{self, Read, Cursor};
use sha2::{Digest, Sha256};
use json::{JsonValue, object};
use pepper_sync::wallet::{NoteInterface, OutputInterface};
use pepper_sync::keys::KeyId;
use zingolib::{wallet::LightWallet, config::ChainType};
use zcash_protocol::memo::Memo;
use zingo_status::confirmation_status::ConfirmationStatus;

fn notes<N: NoteInterface<ZcashNote=orchard::Note, KeyId=KeyId>>(
    items: &[N], receiver: &orchard::Address, account: u32, address: &str, txid: &str,
) -> Result<Vec<JsonValue>, &'static str> {
    let mut result=Vec::new();
    for note in items {
        if u32::from(note.key_id().account_id)!=account || note.key_id().scope!=zip32::Scope::External
            || note.note().recipient()!=*receiver { continue; }
        if note.output_id().txid().to_string()!=txid { return Err("note_transaction_mismatch"); }
        let memo=match note.memo() { Memo::Text(text)=>text.to_string(), _=>continue };
        let index=u32::try_from(note.output_id().output_index()).map_err(|_|"note_index_invalid")?;
        result.push(object!{accountId:account,address:address,scope:"external",outputIndex:index,
            amountZat:note.value().to_string(),memo:memo});
    }
    Ok(result)
}
fn export() -> Result<JsonValue, &'static str> {
    let args:Vec<String>=std::env::args().collect();
    if args.len()!=2 {return Err("wallet_path_required")}
    let mut input=String::new();io::stdin().take(8193).read_to_string(&mut input).map_err(|_|"query_read_failed")?;
    if input.len()>8192 {return Err("query_too_large")}
    let query=json::parse(&input).map_err(|_|"invalid_query")?;
    if !query.is_object()||query.len()!=3 {return Err("invalid_query")}
    let account=query["accountId"].as_u32().ok_or("invalid_account")?;
    let address=query["address"].as_str().ok_or("invalid_address")?;
    let txid=query["txid"].as_str().ok_or("invalid_txid")?;
    if txid.len()!=64||!txid.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c)) {return Err("invalid_txid")}
    let file=std::fs::File::open(&args[1]).map_err(|_|"wallet_open_failed")?;
    if file.metadata().map_err(|_|"wallet_metadata_failed")?.len()>64*1024*1024 {return Err("wallet_too_large")}
    let mut bytes=Vec::new();file.take(64*1024*1024+1).read_to_end(&mut bytes).map_err(|_|"wallet_read_failed")?;
    if bytes.len()>64*1024*1024 {return Err("wallet_too_large")}
    if LightWallet::read_chain(&bytes).map_err(|_|"wallet_chain_unknown")?!=ChainType::Testnet {return Err("wallet_wrong_network")}
    let wallet=LightWallet::read(Cursor::new(&bytes),ChainType::Testnet).map_err(|_|"wallet_decode_failed")?;
    let (_,ua)=wallet.unified_addresses().iter().find(|(id,ua)|u32::from(id.account_id)==account&&ua.encode(&ChainType::Testnet)==address).ok_or("recipient_not_tracked")?;
    let receiver=ua.orchard().ok_or("recipient_has_no_orchard_receiver")?;
    let tip_height=wallet.sync_state.last_known_chain_height().ok_or("wallet_tip_missing")?;
    let tip=wallet.wallet_blocks.get(&tip_height).ok_or("wallet_tip_block_missing")?;
    let mut result=object!{schema:"veildesk.light-wallet-evidence.v1",network:"test",
        walletDigest:hex::encode(Sha256::digest(&bytes)),recipient:object!{accountId:account,address:address,tracked:true},
        tip:object!{height:u32::from(tip_height),hash:tip.block_hash().to_string()},transaction:JsonValue::Null};
    let Some(transaction)=wallet.wallet_transactions.values().find(|tx|tx.txid().to_string()==txid) else {return Ok(result)};
    let tx=transaction.transaction();
    if tx.txid().to_string()!=txid {return Err("transaction_hash_mismatch")}
    let mut raw=Vec::new();tx.write(&mut raw).map_err(|_|"transaction_encode_failed")?;
    if raw.len()<8 {return Err("transaction_header_missing")}
    let version=u32::from_le_bytes(raw[0..4].try_into().unwrap())&0x7fffffff;
    let group=format!("{:08x}",u32::from_le_bytes(raw[4..8].try_into().unwrap()));
    let transparent=tx.transparent_bundle().is_some_and(|bundle|!bundle.vin.is_empty()||!bundle.vout.is_empty());
    let mut evidence=object!{txid:txid,version:version,versionGroupId:group,shieldedOnly:false,
        pool:JsonValue::Null,mined:false,height:JsonValue::Null,blockhash:JsonValue::Null,chain:JsonValue::Array(vec![]),notes:JsonValue::Array(vec![])};
    if !transparent&&tx.sprout_bundle().is_none()&&tx.sapling_bundle().is_none() {
        let (pool,bundle,received)=if version==5&&tx.ironwood_bundle().is_none() {
            ("orchard",tx.orchard_bundle(),notes(transaction.orchard_notes(),receiver,account,address,txid)?)
        }else if version==6&&tx.orchard_bundle().is_none() {
            ("ironwood",tx.ironwood_bundle(),notes(transaction.ironwood_notes(),receiver,account,address,txid)?)
        }else {("unsupported",None,vec![])};
        if let Some(bundle)=bundle {
            evidence["shieldedOnly"]=JsonValue::Boolean(bundle.flags().spends_enabled()&&bundle.flags().outputs_enabled());
            evidence["pool"]=pool.into();evidence["actionCount"]=bundle.actions().len().into();
            evidence["notes"]=JsonValue::Array(received);
        }
    }
    if let ConfirmationStatus::Confirmed(height)=transaction.status() {
        if height>tip_height {return Err("transaction_above_tip")}
        let block=wallet.wallet_blocks.get(&height).ok_or("receipt_block_not_retained")?;
        evidence["mined"]=true.into();evidence["height"]=u32::from(height).into();
        evidence["blockhash"]=block.block_hash().to_string().into();
        let mut chain=Vec::new();
        // Retained contiguous blocks only; never invent an old block or trust a txid hint.
        for h in u32::from(height)..=u32::from(tip_height) {
            if chain.len()>=200 {return Err("receipt_chain_too_long")}
            let b=wallet.wallet_blocks.get(&h.into()).ok_or("receipt_chain_gap")?;
            chain.push(object!{height:h,hash:b.block_hash().to_string(),previousHash:b.prev_hash().to_string()});
        }
        evidence["chain"]=JsonValue::Array(chain);
    }
    result["transaction"]=evidence;Ok(result)
}
fn main(){match export(){Ok(value)=>println!("{}",value.dump()),Err(code)=>{eprintln!("{code}");std::process::exit(1)}}}

#[cfg(test)]
mod tests {
    use super::*;
    use pepper_sync::wallet::{IronwoodNote, OrchardNote, OutputId};
    use zingolib::mocks::orchard_note::OrchardCryptoNoteBuilder;
    use zcash_primitives::transaction::TxId;
    #[test]
    fn native_notes_bind_receiver_account_scope_memo_value_and_output() {
        let txid=TxId::from_bytes([7;32]);
        let crypto=OrchardCryptoNoteBuilder::default().value(orchard::value::NoteValue::from_raw(123456)).build();
        let receiver=crypto.recipient();
        let make=|account,scope|IronwoodNote::new_for_test(OutputId::new(txid,7),account,scope,crypto.clone(),Memo::from_bytes(b"VD1:test-native-memo").unwrap(),None);
        let note=make(zip32::AccountId::ZERO,zip32::Scope::External);
        let exported=notes(&[note],&receiver,0,"fixture-address",&txid.to_string()).unwrap();
        assert_eq!(exported.len(),1);assert_eq!(exported[0]["amountZat"].as_str(),Some("123456"));
        assert_eq!(exported[0]["memo"].as_str(),Some("VD1:test-native-memo"));
        assert_eq!(exported[0]["outputIndex"].as_u32(),Some(7));
        assert!(notes(&[make(zip32::AccountId::ZERO,zip32::Scope::Internal)],&receiver,0,"fixture-address",&txid.to_string()).unwrap().is_empty());
        assert!(notes(&[make(zip32::AccountId::ZERO,zip32::Scope::External)],&receiver,1,"fixture-address",&txid.to_string()).unwrap().is_empty());
        assert!(notes(&[make(zip32::AccountId::ZERO,zip32::Scope::External)],&receiver,0,"fixture-address",&"0".repeat(64)).is_err());
        let key=orchard::keys::SpendingKey::from_bytes([9;32]).unwrap();
        let other=orchard::keys::FullViewingKey::from(&key).address_at(1u32,zip32::Scope::External);
        assert!(notes(&[make(zip32::AccountId::ZERO,zip32::Scope::External)],&other,0,"fixture-address",&txid.to_string()).unwrap().is_empty());
        let orchard=OrchardNote::new_for_test(OutputId::new(txid,2),zip32::AccountId::ZERO,zip32::Scope::External,crypto,Memo::from_bytes(b"VD1:orchard").unwrap(),None);
        assert_eq!(notes(&[orchard],&receiver,0,"fixture-address",&txid.to_string()).unwrap().len(),1);
    }
}
