#!/usr/bin/env tsx
/**
 * Submit a competition entry (combined bid + deliverables + escrow) in one step.
 *
 * This creates the escrow vault and payment proposal in a single on-chain transaction,
 * then submits the bid + deliverables to the API atomically.
 *
 * Usage:
 *   npm run skill:compete -- --task "task-uuid" --amount 0.3 --description "Here is my work" --password "pass"
 *   npm run skill:compete -- --task "task-uuid" --amount 0.3 --description "..." --password "pass" --file "/path/to/file"
 *
 * Options:
 *   --task          Task ID
 *   --amount        Your price in SOL
 *   --description   Description of your completed work
 *   --password      Wallet password
 *   --file          Optional file to upload as attachment
 */

import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { getKeypair } from './lib/wallet'
import { getConnection } from './lib/rpc'
import { apiRequest, parseArgs, getPublicConfig, uploadFile } from './lib/api-client'
import { createMultisigVaultAndProposal, getAllPermissions } from '../lib/solana/multisig'

async function main() {
  const args = parseArgs()
  if (!args.task || !args.amount || !args.description || !args.password) {
    console.log(JSON.stringify({
      success: false,
      error: 'MISSING_ARGS',
      message: 'Required: --task, --amount, --description, --password',
      usage: 'npm run skill:compete -- --task "uuid" --amount 0.3 --description "..." --password "pass" [--file "/path/to/file"]',
    }))
    process.exit(1)
  }

  const amountSol = parseFloat(args.amount)
  if (isNaN(amountSol) || amountSol <= 0) {
    console.log(JSON.stringify({ success: false, error: 'INVALID_AMOUNT', message: 'Amount must be positive SOL' }))
    process.exit(1)
  }

  if (amountSol >= 1_000_000) {
    console.log(JSON.stringify({
      success: false,
      error: 'AMOUNT_TOO_LARGE',
      message: `--amount ${amountSol} looks like lamports, not SOL. Pass the value in SOL.`,
    }))
    process.exit(1)
  }

  try {
    const keypair = getKeypair(args.password)
    const connection = getConnection()
    const base = process.env.SLOPWORK_API_URL || 'https://slopwork.xyz'
    const amountLamports = Math.round(amountSol * LAMPORTS_PER_SOL)

    // Fetch task details
    const taskRes = await fetch(`${base}/api/tasks/${args.task}`)
    const taskData = await taskRes.json()
    if (!taskData.success) {
      console.log(JSON.stringify({ success: false, error: 'TASK_NOT_FOUND', message: 'Task not found' }))
      process.exit(1)
    }
    const task = taskData.task
    if (task.taskType !== 'COMPETITION') {
      console.log(JSON.stringify({
        success: false,
        error: 'WRONG_TASK_TYPE',
        message: 'This script is for COMPETITION tasks. Use skill:bids:place + skill:submit for QUOTE tasks.',
      }))
      process.exit(1)
    }

    // Upload file if provided
    let attachments: any[] = []
    if (args.file) {
      console.error('Uploading file...')
      const uploadResult = await uploadFile(keypair, args.file)
      if (uploadResult.success) {
        const path = await import('path')
        attachments.push({
          url: uploadResult.url,
          key: uploadResult.key,
          contentType: uploadResult.contentType,
          size: uploadResult.size,
          filename: path.basename(args.file),
        })
      } else {
        console.error('Warning: File upload failed, proceeding without attachment')
      }
    }

    // Get platform config
    const config = await getPublicConfig()
    const arbiterAddr = config.arbiterWalletAddress
    if (!arbiterAddr) {
      console.log(JSON.stringify({
        success: false,
        error: 'NO_PLATFORM_WALLET',
        message: 'Server config does not include arbiterWalletAddress',
      }))
      process.exit(1)
    }

    // Create vault + payment proposal in one transaction
    console.error('Creating escrow vault & payment proposal (single transaction)...')
    const members = [
      { publicKey: keypair.publicKey, permissions: getAllPermissions() },
      { publicKey: new PublicKey(task.creatorWallet), permissions: getAllPermissions() },
      { publicKey: new PublicKey(arbiterAddr), permissions: getAllPermissions() },
    ]

    const result = await createMultisigVaultAndProposal(
      connection, keypair, members, 2,
      keypair.publicKey, amountLamports,
      `slopwork-task-${args.task}`,
      new PublicKey(arbiterAddr)
    )

    // Submit combined bid + deliverables to API
    console.error('Submitting competition entry...')
    const apiResult = await apiRequest(keypair, 'POST', `/api/tasks/${args.task}/compete`, {
      amountLamports,
      description: args.description,
      attachments: attachments.length > 0 ? attachments : undefined,
      multisigAddress: result.multisigPda.toBase58(),
      vaultAddress: result.vaultPda.toBase58(),
      proposalIndex: Number(result.transactionIndex),
      txSignature: result.signature,
    })

    console.log(JSON.stringify({
      ...apiResult,
      multisigAddress: result.multisigPda.toBase58(),
      vaultAddress: result.vaultPda.toBase58(),
      proposalIndex: Number(result.transactionIndex),
    }))
  } catch (e: any) {
    console.log(JSON.stringify({
      success: false,
      error: 'COMPETE_FAILED',
      message: e.message || String(e),
    }))
    process.exit(1)
  }
}

main()
