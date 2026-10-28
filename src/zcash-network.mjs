export function walletCapability(network='test'){return `zcash.receipt.check.${walletNetwork(network).chain}.v1`}
export function nativeBackendId(network,accountId){return `zingolib-${walletNetwork(network).chain}-v1:${accountId}`}
// Network selection is explicit and never inferred from an address or endpoint.
export function walletNetwork(network='test'){
 if(network==='test')return {network,chain:'testnet',indexer:'https://testnet.zec.rocks:443'};
 if(network==='main')return {network,chain:'mainnet',indexer:'https://zec.rocks:443'};
 throw Error('Unsupported wallet network');
}

export function paidMandateCapability(network='test'){return `prediction.mandate.validate.${walletNetwork(network).chain}-paid.v1`}
export function paidResearchCapability(network='test'){return `polydesk.research.${walletNetwork(network).chain}-paid.v1`}

export function configuredPayment(config){
 const test=config.testnetPayment?.enabled===true,main=config.mainnetPayment?.enabled===true;
 if(test&&main)throw Error('Enable only one payment network');
 const payment=main?config.mainnetPayment:test?config.testnetPayment:undefined;
 if(payment&&payment.network!==(main?'main':'test'))throw Error('Payment configuration network mismatch');
 return payment;
}
