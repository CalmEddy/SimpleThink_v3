import React from 'react';
import clsx from 'clsx';
import type { LabToken } from './templateLabStore';

type TokenPreviewProps = {
  token: LabToken;
};

const TokenPreview: React.FC<TokenPreviewProps> = ({ token }) => (
  <div
    className={clsx(
      'flex select-none items-center gap-2 rounded-full border px-3 py-2 text-sm shadow-lg',
      token.kind === 'slot' ? 'border-blue-400 bg-blue-500/20 text-blue-100' : 'border-slate-700 bg-slate-800/80 text-slate-100'
    )}
  >
    {token.kind === 'slot' ? (
      <>
        <span className="font-semibold">{token.pos}</span>
        <span className="text-xs text-slate-200">{token.morph ?? 'base'}</span>
      </>
    ) : (
      <span>{token.text}</span>
    )}
  </div>
);

export default TokenPreview;
