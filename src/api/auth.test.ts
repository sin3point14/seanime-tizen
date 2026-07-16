import CryptoJS from "crypto-js"
import { createMediaToken, hashPassword } from "./auth"

describe("Seanime authentication", () => {
  it("hashes the trimmed password as SHA-256 hex", () => {
    expect(hashPassword(" password ")).toBe(CryptoJS.SHA256("password").toString(CryptoJS.enc.Hex))
  })

  it("creates a URL-safe signed 24-hour token", () => {
    const token = createMediaToken("secret", "/api/v1/mediastream/file", 1_000)
    const [claims, signature] = token.split(".")
    expect(claims).toMatch(/^[\w-]+$/)
    expect(signature).toMatch(/^[\w-]+$/)
    const decoded = JSON.parse(atob(claims.replace(/-/g, "+").replace(/_/g, "/")))
    expect(decoded).toEqual({ endpoint: "/api/v1/mediastream/file", iat: 1_000, exp: 87_400 })
  })
})
