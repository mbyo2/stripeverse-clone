import { useAccount, useBalance, useChainId, useReadContract } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CHAIN_LABELS, NATIVE_SYMBOLS, USDC_ADDRESSES } from "@/lib/web3/wagmiConfig";

export const BalancesCard = () => {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const { data: native } = useBalance({ address, chainId, query: { enabled: isConnected } });

  const usdcAddr = USDC_ADDRESSES[chainId];
  const { data: usdcBal } = useReadContract({
    address: usdcAddr,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId,
    query: { enabled: isConnected && !!usdcAddr && !!address },
  });

  if (!isConnected) {
    return (
      <Card>
        <CardHeader><CardTitle>Balances</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Connect a wallet to view balances.</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Balances · {CHAIN_LABELS[chainId] ?? `Chain ${chainId}`}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">{NATIVE_SYMBOLS[chainId] ?? "Native"}</span>
          <span className="font-mono">{native ? Number(native.formatted).toFixed(6) : "—"}</span>
        </div>
        <div className="flex items-baseline justify-between">
          <span className="text-sm text-muted-foreground">USDC</span>
          <span className="font-mono">
            {usdcBal !== undefined ? Number(formatUnits(usdcBal as bigint, 6)).toFixed(2) : "—"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};