import { WagmiProvider } from "wagmi";
import { RainbowKitProvider, darkTheme } from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/web3/wagmiConfig";
import "@rainbow-me/rainbowkit/styles.css";

export const Web3Provider = ({ children }: { children: React.ReactNode }) => {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider theme={darkTheme()} modalSize="compact">
        {children}
      </RainbowKitProvider>
    </WagmiProvider>
  );
};