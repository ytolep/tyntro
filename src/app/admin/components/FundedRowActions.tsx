'use client';

import React from 'react';
import ConfirmButton from './ConfirmButton';

/** Approve funded / Reject для PASSED-счёта: подтверждение вторым нажатием на месте, без window.confirm. */
export default function FundedRowActions({
  disabled,
  onApprove,
  onReject,
}: {
  disabled: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="k1-actions">
      <ConfirmButton
        label="Approve funded"
        className="k1-btn k1-btn-primary"
        disabled={disabled}
        onConfirm={onApprove}
      />
      <ConfirmButton label="Reject" className="k1-btn k1-btn-danger" disabled={disabled} onConfirm={onReject} />
    </div>
  );
}
