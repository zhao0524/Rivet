/** @type {import('next').NextConfig} */
const nextConfig = {
  // Test servers build into their own folder: a second `next dev` sharing `.next` with the
  // developer's server overwrites its compiled client code (and its NEXT_PUBLIC_* values).
  distDir: process.env.RIVET_NEXT_DIST_DIR || '.next',
  transpilePackages: ['three', '@react-three/fiber', '@react-three/drei'],
  eslint: {
    ignoreDuringBuilds: true,
  },
  async rewrites() {
    const apiTarget = process.env.NEXT_PUBLIC_RIVET_API_URL || 'http://localhost:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${apiTarget.replace(/\/+$/, '')}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
