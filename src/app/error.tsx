'use client';

import { useEffect } from 'react';
import { RefreshCw, AlertTriangle } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('App Router Runtime Error:', error);
  }, [error]);

  return (
    <div className="min-h-[70vh] bg-[#09090d] flex flex-col items-center justify-center p-6 text-center font-mono">
      <div className="bg-[#101015] border border-[#25252e] p-8 rounded-2xl max-w-md w-full space-y-4 shadow-2xl">
        <div className="w-12 h-12 rounded-xl bg-red-950/40 border border-red-800/40 flex items-center justify-center mx-auto text-red-400">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-white">Application Error</h2>
        <p className="text-xs text-gray-400">
          {error?.message || 'An unexpected error occurred while rendering the page.'}
        </p>
        <button
          onClick={() => reset()}
          className="w-full py-3 bg-[#8ff0cc] hover:opacity-90 text-black font-extrabold text-xs rounded-xl flex items-center justify-center space-x-2 transition-all"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Reload Section</span>
        </button>
      </div>
    </div>
  );
}
