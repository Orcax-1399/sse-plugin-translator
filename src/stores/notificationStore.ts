import { create } from 'zustand';

/**
 * 通知类型
 */
export type NotificationType = 'success' | 'error' | 'warning' | 'info';

/**
 * 通知消息
 */
export interface Notification {
  id: string;
  message: string;
  type: NotificationType;
  duration?: number; // 显示时长（毫秒），默认6000
}

/**
 * 通知状态
 */
interface NotificationState {
  notifications: Notification[];
  showNotification: (message: string, type: NotificationType, duration?: number) => void;
  removeNotification: (id: string) => void;
}

/**
 * 通知状态管理
 */
export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],

  /**
   * 显示通知
   */
  showNotification: (message: string, type: NotificationType, duration = 6000) => {
    const id = `notification-${Date.now()}-${Math.random()}`;
    const notification: Notification = { id, message, type, duration };

    set((state) => ({
      notifications: [...state.notifications, notification],
    }));

    // 自动移除通知
    if (duration > 0) {
      setTimeout(() => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        }));
      }, duration);
    }
  },

  /**
   * 移除通知
   */
  removeNotification: (id: string) => {
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    }));
  },
}));

/**
 * 便捷方法：显示成功通知
 */
export const showSuccess = (message: string, duration?: number) => {
  useNotificationStore.getState().showNotification(message, 'success', duration);
};

/**
 * 便捷方法：显示错误通知
 */
export const showError = (message: string, duration?: number) => {
  useNotificationStore.getState().showNotification(message, 'error', duration);
};

/**
 * 便捷方法：显示警告通知
 */
export const showWarning = (message: string, duration?: number) => {
  useNotificationStore.getState().showNotification(message, 'warning', duration);
};

/**
 * 便捷方法：显示信息通知
 */
export const showInfo = (message: string, duration?: number) => {
  useNotificationStore.getState().showNotification(message, 'info', duration);
};
