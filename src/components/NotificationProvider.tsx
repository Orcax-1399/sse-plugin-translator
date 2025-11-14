import { Snackbar, Alert } from '@mui/material';
import { useNotificationStore } from '../stores/notificationStore';

/**
 * 全局通知提供者组件
 *
 * 使用方法：
 * ```tsx
 * import { showSuccess, showError } from '../stores/notificationStore';
 *
 * showSuccess('操作成功！');
 * showError('操作失败，请重试。');
 * ```
 */
export default function NotificationProvider() {
  const { notifications, removeNotification } = useNotificationStore();

  return (
    <>
      {notifications.map((notification, index) => (
        <Snackbar
          key={notification.id}
          open={true}
          autoHideDuration={notification.duration}
          onClose={() => removeNotification(notification.id)}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          style={{ top: 24 + index * 60 }} // 多个通知堆叠显示
        >
          <Alert
            onClose={() => removeNotification(notification.id)}
            severity={notification.type}
            variant="filled"
            sx={{ width: '100%' }}
          >
            {notification.message}
          </Alert>
        </Snackbar>
      ))}
    </>
  );
}
