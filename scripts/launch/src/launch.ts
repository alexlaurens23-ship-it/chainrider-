/**
 * pump.fun token launch via PumpPortal (REST). Implementation lands in the
 * launch phase; the typed surface is defined now so callers can be written
 * against it. Launch market cap is hardcoded at $4,000 USD — never scraped.
 */

export interface PumpPortalLaunchParams {
  tokenName: string;
  tokenSymbol: string;
  description: string;
  /** Local path to the token image uploaded with the metadata. */
  imagePath: string;
  twitter?: string;
  telegram?: string;
  website?: string;
  /** Initial dev buy in SOL. */
  devBuySol: number;
  /** Priority fee in SOL. */
  priorityFeeSol: number;
  /** Slippage tolerance for the dev buy, in percent. */
  slippagePercent: number;
}

export interface LaunchResult {
  mintAddress: string;
  transactionSignature: string;
}

export async function launchToken(params: PumpPortalLaunchParams): Promise<LaunchResult> {
  throw new Error(`launchToken not implemented yet (requested symbol: ${params.tokenSymbol})`);
}
