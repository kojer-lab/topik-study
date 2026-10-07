const CACHE='topik-v1600';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./questions-extra.js?v=110','./vocab-catalog.js?v=140','./vocab-essential.js?v=191','./vocab-examples-301-400.js?v=1201','./vocab-examples-401-500.js?v=1201','./vocab-examples-001-100.js?v=1201','./vocab-examples-101-200.js?v=1410','./vocab-examples-201-300.js?v=1201','./vocab-examples-501-600.js?v=1201','./vocab-examples-601-700.js?v=1201','./vocab-examples-701-800.js?v=1201','./vocab-upper-batch-a.js?v=1410','./vocab-upper-batch-b.js?v=1410','./vocab-upper-batch-c.js?v=1410','./vocab-upper-batch-d.js?v=1410','./vocab-upper-batch-e.js?v=1410','./vocab-upper-batch-f.js?v=1410','./vocab-upper-batch-g.js?v=1410','./questions-exam.js?v=190','./questions-training-01.js?v=1410','./questions-training-02.js?v=1410','./questions-training-03.js?v=1410','./tts/manifest.js?v=1500'];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;

  // The neural-voice manifest is updated when MP3 clips are generated.
  // Refresh it online without forcing a new service-worker version for every batch.
  if(new URL(req.url).pathname.endsWith("/tts/manifest.js")){
    event.respondWith(fetch(req).then(res=>{
      if(res.ok)caches.open(CACHE).then(cache=>cache.put(req,res.clone()));
      return res;
    }).catch(()=>caches.match(req)));
    return;
  }
  // Offline-first after the first playback of an AI clip.
  if(new URL(req.url).pathname.includes("/tts/ko/")){
    event.respondWith(caches.open(CACHE).then(async cache=>{
      const saved=await cache.match(req);
      if(saved)return saved;
      const res=await fetch(req);
      if(res.ok)cache.put(req,res.clone());
      return res;
    }));
    return;
  }
  if(req.mode==='navigate'){
    event.respondWith(
      fetch(req)
        .then(res=>{
          const copy=res.clone();
          caches.open(CACHE).then(cache=>cache.put('./index.html',copy));
          return res;
        })
        .catch(()=>caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached=>cached || fetch(req))
  );
});
