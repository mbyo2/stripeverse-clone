import { useAccount, useChainId, useDisconnect, useSwitchChain } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CHAIN_LABELS, SUPPORTED_CHAINS, WALLETCONNECT_PROJECT_ID } from "@/lib/web3/wagmiConfig";
import { Loader2, Plug, PlugZap, Unplug, AlertTriangle } from "lucide-react";

export const WalletConnectStatus = () => {
  const { address, status, connector, chainId: accountChainId } = useAccount();
  const activeChainId = useChainId();
  const { disconnect, isPending: disconnecting } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();

  const projectIdMissing =
    !WALLETCONNECT_PROJECT_ID || WALLETCONNECT_PROJECT_ID.startsWith("REPLACE_");

  const stateMeta: Record<typeof status, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: JSX.Element }> = {
    disconnected: { label: "Disconnected", variant: "outline", icon: <Unplug className="h-3.5 w-3.5" /> },
    connecting: { label: "Pairing…", variant: "secondary", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    reconnecting: { label: "Reconnecting…", variant: "secondary", icon: <Loader2 className="h-3.5 w-3.5 animate-spin" /> },
    connected: { label: "Connected", variant: "default", icon: <PlugZap className="h-3.5 w-3.5" /> },
  } as const;

  const meta = stateMeta[status];
  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;
  const onWrongChain =
    status === "connected" &&
    accountChainId !== undefined &&
    !SUPPORTED_CHAINS.some((c) => c.id === accountChainId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Plug className="h-4 w-4" />
          WalletConnect Status
        </CardTitle>
        <Badge variant={meta.variant} className="flex items-center gap-1">
          {meta.icon}
          {meta.label}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {projectIdMissing && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              WalletConnect Project ID is missing. Mobile QR pairing will not work until
              <code className="mx-1">VITE_WALLETCONNECT_PROJECT_ID</code> is set.
            </span>
          </div>
        )}

        <div className="grid gap-2 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Account</span>
            <span className="font-mono">{short ?? "—"}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Connector</span>
            <span>{connector?.name ?? "—"}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Active chain</span>
            <span>
              {status === "connected"
                ? CHAIN_LABELS[activeChainId] ?? `Chain ${activeChainId}`
                : "—"}
            </span>
          </div>
        </div>

        {onWrongChain && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600" />
            <span>Your wallet is on an unsupported chain. Switch to a supported network below.</span>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Supported chains</p>
          <div className="flex flex-wrap gap-2">
            {SUPPORTED_CHAINS.map((c) => {
              const isActive = status === "connected" && activeChainId === c.id;
              return (
                <Button
                  key={c.id}
                  type="button"
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  disabled={status !== "connected" || switching || isActive}
                  onClick={() => switchChain({ chainId: c.id })}
                  className="h-7 px-2 text-xs"
                >
                  {switching && !isActive ? (
                    <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  ) : null}
                  {CHAIN_LABELS[c.id] ?? c.name}
                </Button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <ConnectButton
            showBalance={false}
            accountStatus="address"
            chainStatus="icon"
          />
          {status === "connected" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => disconnect()}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <Unplug className="mr-1 h-3 w-3" />
              )}
              Disconnect
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
};