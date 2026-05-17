import { HeroSection } from '@/components/home/HeroSection'
import { StatsSection } from '@/components/home/StatsSection'
import { ServicesSection } from '@/components/home/ServicesSection'
import { RealisationsSection } from '@/components/home/RealisationsSection'
import { TemoignagesSection } from '@/components/home/TemoignagesSection'
import { CtaSection } from '@/components/home/CtaSection'
import { ContactSection } from '@/components/home/ContactSection'

export default function HomePage() {
  return (
    <>
      <HeroSection />
      <StatsSection />
      <ServicesSection />
      <RealisationsSection />
      <TemoignagesSection />
      <CtaSection />
      <ContactSection />
    </>
  )
}
