'use client';

import React, { useEffect, useRef, useState } from 'react';

/**
 * Кнопка с подтверждением вторым нажатием: первый клик показывает «Confirm?»,
 * второй — выполняет. Дубли запроса исключены: родитель держит disabled на время
 * запроса, а синхронный флаг гасит второй клик до ре-рендера. Уход фокуса снимает подтверждение.
 */
export default function ConfirmButton({
  label,
  className = '',
  disabled = false,
  onConfirm,
}: {
  label: string;
  className?: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const firing = useRef(false);

  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);

  return (
    <button
      type="button"
      className={`${className}${armed ? ' k1-armed' : ''}`}
      disabled={disabled}
      onClick={() => {
        if (firing.current) return;
        if (!armed) {
          setArmed(true);
          return;
        }
        firing.current = true;
        setArmed(false);
        try {
          onConfirm();
        } finally {
          firing.current = false;
        }
      }}
      onBlur={() => setArmed(false)}
    >
      {armed ? 'Confirm?' : label}
    </button>
  );
}
