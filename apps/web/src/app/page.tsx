import { Footer } from "../components/home/Footer.js";
import { Hero } from "../components/home/Hero.js";
import { HowItWorks } from "../components/home/HowItWorks.js";
import { TrustSection } from "../components/home/TrustSection.js";

export default function HomePage() {
  return (
    <main>
      <Hero />
      <HowItWorks />
      <TrustSection />
      <Footer />
    </main>
  );
}
