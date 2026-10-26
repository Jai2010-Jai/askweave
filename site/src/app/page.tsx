import { Builders } from "@/components/Builders";
import { Changes } from "@/components/Changes";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Intro } from "@/components/Intro";
import { Nav } from "@/components/Nav";
import { Waitlist } from "@/components/Waitlist";

export default function Home() {
  return (
    <>
      <Intro />
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Builders />
        <Changes />
        <Waitlist />
      </main>
      <Footer />
    </>
  );
}
