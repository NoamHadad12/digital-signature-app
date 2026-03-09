/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback } from 'react';
import { CheckCircle2, XCircle, Info, AlertTriangle } from 'lucide-react';
import ConfirmModal from '../components/ui/ConfirmModal';
import Toast from '../components/ui/Toast';

const NotificationContext = createContext();

export const useNotification = () => useContext(NotificationContext);

export const NotificationProvider = ({ children }) => {
  const [toast, setToast] = useState(null);
  const [confirmConfig, setConfirmConfig] = useState(null);

  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  }, []);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmConfig({
        ...options,
        onConfirm: () => {
          setConfirmConfig(null);
          resolve(true);
        },
        onCancel: () => {
          setConfirmConfig(null);
          resolve(false);
        },
      });
    });
  }, []);

  return (
    <NotificationContext.Provider value={{ showToast, confirm }}>
      {children}
      
      {/* Global Toast */}
      <Toast toast={toast} />

      {/* Global Confirm Modal */}
      {confirmConfig && (
        <ConfirmModal
          isOpen={true}
          title={confirmConfig.title}
          description={confirmConfig.description}
          cancelText={confirmConfig.cancelText || 'Cancel'}
          confirmText={confirmConfig.confirmText || 'Confirm'}
          confirmVariant={confirmConfig.confirmVariant || 'danger'}
          onCancel={confirmConfig.onCancel}
          onConfirm={confirmConfig.onConfirm}
        />
      )}
    </NotificationContext.Provider>
  );
};