'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global Error Boundary caught:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-[#09090d] text-white font-mono flex items-center justify-center min-h-screen p-4">
        <div className="bg-[#101015] border border-[#25252e] p-8 rounded-2xl max-w-md w-full text-center space-y-4 shadow-2xl">
          <h1 className="text-xl font-extrabold text-red-400">Critical Error</h1>
          <p className="text-xs text-gray-400">
            {error?.message || 'A critical error occurred in the application root.'}
          </p>
          <button
            onClick={() => reset()}
            className="w-full py-3 bg-[#8ff0cc] text-black font-extrabold text-xs rounded-xl hover:opacity-90 transition-all"
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
