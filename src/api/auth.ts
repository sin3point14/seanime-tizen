import CryptoJS from "crypto-js"

export function hashPassword(password: string) {
  return CryptoJS.SHA256(password.trim()).toString(CryptoJS.enc.Hex)
}

export interface TokenClaims { endpoint: string; iat: number; exp: number }

const base64Url = (value: CryptoJS.lib.WordArray | string) => {
  const wordArray = typeof value === "string" ? CryptoJS.enc.Utf8.parse(value) : value
  return CryptoJS.enc.Base64.stringify(wordArray).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export function createMediaToken(secret: string, endpoint: string, nowSeconds = Math.floor(Date.now() / 1000)) {
  const claims: TokenClaims = { endpoint, iat: nowSeconds, exp: nowSeconds + 24 * 60 * 60 }
  const encodedClaims = base64Url(JSON.stringify(claims))
  return `${encodedClaims}.${base64Url(CryptoJS.HmacSHA256(encodedClaims, secret))}`
}
