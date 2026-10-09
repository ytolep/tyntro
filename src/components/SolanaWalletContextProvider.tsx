'use client';

import React, { FC, ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';

// Стили кошелька НЕ импортируем из пакета: styles.css делает @import Google Fonts,
// который блокирует CSP. Правила .wallet-adapter-* перенесены в globals.css
// (блок /* Q4 wallet-adapter */) без @import, с font-family: inherit.
export const SolanaWalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  // Сеть кошелька: свой RPC (например devnet для тестов оплаты checkout), иначе
  // публичный кластер NEXT_PUBLIC_SOLANA_CLUSTER. Рыночные данные Phoenix
  // не затрагиваются — они всегда ходят на mainnet по своему RPC.
  // NEXT_PUBLIC_SOLANA_CLUSTER контролируется оператором деплоя, поэтому сужение до Cluster безопасно.
  const endpoint = useMemo(
    () =>
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ||
      clusterApiUrl((process.env.NEXT_PUBLIC_SOLANA_CLUSTER || 'mainnet-beta') as 'devnet' | 'testnet' | 'mainnet-beta'),
    [],
  );

  // Standard wallets (Phantom, Solflare, Backpack) are automatically registered
  // by standard browser extensions via Wallet Standard protocol
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};
