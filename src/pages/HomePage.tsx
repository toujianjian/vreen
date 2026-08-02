import { Hero } from '@/components/home/Hero';
import { Gallery } from '@/components/home/Gallery';
import { Capabilities } from '@/components/home/Capabilities';
import { Uploader } from '@/components/home/Uploader';
import { TerminalLog } from '@/components/home/TerminalLog';
import { Footer } from '@/components/home/Footer';

export function HomePage() {
  return (
    <main className="relative">
      <Hero />
      <Gallery />
      <Capabilities />
      <Uploader />
      <TerminalLog />
      <Footer />
    </main>
  );
}
