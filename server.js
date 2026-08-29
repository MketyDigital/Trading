import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = 3000;

const server = http.createServer((req, res) => {
    // Basic status page for Cloud Run container environment
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html>
<html>
<head>
    <title>Mkety Copier Engine</title>
    <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-gray-50 flex items-center justify-center min-h-screen">
    <div class="bg-white p-8 rounded-xl shadow-sm border border-gray-200 max-w-lg text-center">
        <h1 class="text-2xl font-bold text-gray-900 mb-2">Mkety Copier Engine</h1>
        <p class="text-sm text-gray-600 mb-4">Cloudflare Worker source files ready in <code>/cloudflare-v2/</code></p>
        <span class="inline-block bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full font-semibold">Production Ready</span>
    </div>
</body>
</html>`);
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on port ${PORT}`);
});
