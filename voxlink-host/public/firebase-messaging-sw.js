// Firebase Cloud Messaging Service Worker
// Handles background push notifications on web
//
// IMPORTANT: Firebase config values must be injected at build time via your
// CI/CD pipeline or a build script. Do NOT hardcode production credentials here.
// See .env.example for the required EXPO_PUBLIC_FIREBASE_* variables.

importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.0/firebase-messaging-compat.js');

// These placeholders are replaced at build time by the CI/CD pipeline.
// If you see "__FIREBASE_*__" in production, the build step is misconfigured.
firebase.initializeApp({
  apiKey: "__FIREBASE_API_KEY__",
  authDomain: "__FIREBASE_AUTH_DOMAIN__",
  projectId: "__FIREBASE_PROJECT_ID__",
  storageBucket: "__FIREBASE_STORAGE_BUCKET__",
  messagingSenderId: "__FIREBASE_MESSAGING_SENDER_ID__",
  appId: "__FIREBASE_APP_ID__",
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
