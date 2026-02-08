import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { generateNonce, buildSignMessage } from '@/lib/auth'
import { rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import bs58 from 'bs58'

/** Validate that a string is a valid base58-encoded Solana public key (32 bytes) */
function isValidSolanaAddress(address: string): boolean {
  try {
    if (address.length < 32 || address.length > 44) return false
    const decoded = bs58.decode(address)
    return decoded.length === 32
  } catch {
    return false
  }
}

export async function GET(request: NextRequest) {
  const wallet = request.nextUrl.searchParams.get('wallet')
  if (!wallet || !isValidSolanaAddress(wallet)) {
    return Response.json(
      { success: false, error: 'INVALID_WALLET', message: 'Provide a valid Solana wallet address as ?wallet=...' },
      { status: 400 }
    )
  }

  // Rate limit per wallet
  const rl = rateLimitResponse(`auth:${wallet}`, RATE_LIMITS.auth)
  if (rl) return rl

  const nonce = generateNonce()
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

  // Clean up ALL expired nonces globally (not just this wallet) to prevent DB bloat
  await prisma.authNonce.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  })

  await prisma.authNonce.create({
    data: { walletAddress: wallet, nonce, expiresAt },
  })

  return Response.json({
    success: true,
    nonce,
    message: buildSignMessage(nonce),
    expiresAt: expiresAt.toISOString(),
  })
}
