// Firebase Cloud Messaging Service Worker
// Handles background push notifications on web

importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyD46BXKhAh8Gh8Zu7XvM1J-wSLs8g4lLRc",
  authDomain: "connectme-80909.firebaseapp.com",
  projectId: "connectme-80909",
  storageBucket: "connectme-80909.firebasestorage.app",
  messagingSenderId: "128169786412",
  appId: "1:128169786412:web:11cf3612a7f4520f98e589",
});

const messaging = firebase.messaging();

// Background message handler
messaging.onBackgroundMessage((payload) => {
  const { title, body, image } = payload.notification ?? {};
  const data = payload.data ?? {};

  const notifTitle = title || 'VoxLink';
  const notifOptions = {
    body: body || '',
    icon: image || '/assets/images/icon.png',
    badge: '/assets/images/icon.png',
    data,
    tag: data.type || 'voxlink',
    requireInteraction: data.type === 'incoming_call',
    vibrate: data.type === 'incoming_call' ? [200, 100, 200, 100, 200] : [200],
    actions:
      data.type === 'incoming_call'
        ? [
            { action: 'accept', title: 'Accept' },
            { action: 'decline', title: 'Decline' },
          ]
        : [],
  };

  self.registration.showNotification(notifTitle, notifOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};

  let url = '/';
  if (data.type === 'incoming_call' && data.session_id) {
    url = `/shared/call/incoming?session_id=${data.session_id}`;
  } else if (data.type === 'chat_message' && data.room_id) {
    url = `/shared/chat/${data.room_id}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({ type: 'NOTIFICATION_CLICK', data });
          return;
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
    })
  );
});
