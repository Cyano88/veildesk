export async function loadEndpointIdentity(value){
 const recipient={publicKey:value.encryption.publicKey,privateKey:await crypto.subtle.importKey('jwk',value.encryption.privateKey,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits'])};
 const signer={publicKey:value.signing.publicKey,privateKey:await crypto.subtle.importKey('jwk',value.signing.privateKey,{name:'ECDSA',namedCurve:'P-256'},false,['sign'])};
 return {recipient,signer};
}
