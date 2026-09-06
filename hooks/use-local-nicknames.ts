'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'aura_custom_nicknames';

export function useLocalNicknames() {
  const [nicknames, setNicknames] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          setNicknames(JSON.parse(e.newValue));
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  const setNickname = useCallback((participantId: string, nickname: string) => {
    setNicknames((prev) => {
      const trimmed = nickname.trim();
      const updated = { ...prev };
      if (trimmed) {
        updated[participantId] = trimmed;
      } else {
        delete updated[participantId];
      }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const removeNickname = useCallback((participantId: string) => {
    setNicknames((prev) => {
      const updated = { ...prev };
      delete updated[participantId];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const getDisplayName = useCallback(
    (participantId: string, defaultName: string) => {
      return nicknames[participantId] || defaultName;
    },
    [nicknames]
  );

  return {
    nicknames,
    setNickname,
    removeNickname,
    getDisplayName,
  };
}
