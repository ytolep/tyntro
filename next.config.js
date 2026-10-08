/** @type {import('next').NextConfig} */
const nextConfig = {
  // Агент J (эксплуатация): standalone-выход для Docker-образа (server.js).
  // Остальные настройки next.config относит к себе агент I — не расширять здесь.
  output: 'standalone',
};

module.exports = nextConfig;
