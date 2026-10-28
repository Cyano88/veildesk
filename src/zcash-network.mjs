// Network selection is explicit and never inferred from an address or endpoint.
export function walletNetwork(network='test'){
 if(network==='test')return {network,chain:'testnet',indexer:'https://testnet.zec.rocks:443'};
 if(network==='main')return {network,chain:'mainnet',indexer:'https://zec.rocks:443'};
 throw Error('Unsupported wallet network');
}
