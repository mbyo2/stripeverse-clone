import { useState } from "react";
import { Web3Provider } from "@/components/web3/Web3Provider";
import { LinkAddressCard } from "@/components/web3/LinkAddressCard";
import { LinkedAddressList } from "@/components/web3/LinkedAddressList";
import { BalancesCard } from "@/components/web3/BalancesCard";
import { RequestPayoutForm } from "@/components/web3/RequestPayoutForm";
import { PayoutHistoryTable } from "@/components/web3/PayoutHistoryTable";

const CryptoWallet = () => {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <Web3Provider>
      <div className="container mx-auto max-w-5xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Crypto Wallet</h1>
          <p className="text-sm text-muted-foreground">
            Connect an EVM wallet to receive USDC and native-token payouts on Ethereum, Base, Polygon, Arbitrum, or Sepolia.
          </p>
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <LinkAddressCard onLinked={bump} />
          <BalancesCard />
        </div>

        <LinkedAddressList refreshKey={refreshKey} />

        <div className="grid gap-6 md:grid-cols-2">
          <RequestPayoutForm onSubmitted={bump} />
          <PayoutHistoryTable refreshKey={refreshKey} />
        </div>
      </div>
    </Web3Provider>
  );
};

export default CryptoWallet;