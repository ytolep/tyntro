'use client';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';

// Dynamically import TradingViewChart with SSR disabled
const TradingViewChart = dynamic(() => import('@/components/TradingViewChart'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full min-h-[490px] bg-[#09090d] flex items-center justify-center text-xs text-gray-400 font-mono space-x-2 border border-[#25252e]">
      <Loader2 className="w-4 h-4 animate-spin text-[#8ff0cc]" />
      <span>Loading Phoenix chart...</span>
    </div>
  ),
});

export default function ChartPanel({ symbol }: { symbol: string }) {
  return (
    <div className="terminal-chart bg-[#101015] border border-[#25252e] rounded-lg overflow-hidden flex flex-col h-full min-h-[490px]">
      <div className="w-full h-full min-h-[490px] flex-grow">
        <TradingViewChart key={symbol} symbol={symbol} />
      </div>
    </div>
  );
}
