import { Car, Hotel, Globe, Pizza, ArrowRight, Sparkles } from 'lucide-react';

interface FeaturesSectionProps {
  onOpenDownload: () => void;
}

export const FeaturesSection: React.FC<FeaturesSectionProps> = ({ onOpenDownload }) => {
  const features = [
    {
      icon: <Car className="size-6 text-[#ff5100]" />,
      badge: 'TRAVEL & COMMUTE',
      title: 'Book Cabs in Seconds',
      description: 'Just message where you want to go. Weave checks prices across rideshare services, finds the fastest ride, and books your cab automatically.',
      example: '"Book me an Uber to Central Park in 15 mins"'
    },
    {
      icon: <Hotel className="size-6 text-[#ff5100]" />,
      badge: 'VACATIONS & STAYS',
      title: 'Hotel & Travel Reservations',
      description: 'Planning a trip? Tell Weave your dates and budget. It finds top-rated stays, compares rates, and confirms your booking with zero hassle.',
      example: '"Find a pet-friendly boutique hotel in Austin under $180"'
    },
    {
      icon: <Globe className="size-6 text-[#ff5100]" />,
      badge: 'WEBSITES & PAGES',
      title: 'Instant Websites & Pages',
      description: 'Want a website for your business, shop, or personal portfolio? Just describe what you need, and Weave creates it and puts it right on the web.',
      example: '"Create a one-page site for my handmade candle shop"'
    },
    {
      icon: <Pizza className="size-6 text-[#ff5100]" />,
      badge: 'DAILY ERRANDS',
      title: 'Food & Everyday Tasks',
      description: 'Reorder dinner, summarize long PDF documents, check emails, or manage daily chores without juggling five different apps on your phone.',
      example: '"Order 2 burritos from Chipotle to my home address"'
    }
  ];

  return (
    <section className="flex flex-col gap-8 py-8 border-t border-[#ead6cd] font-sans" id="features">
      <div className="flex flex-col gap-2 max-w-2xl">
        <span className="text-xs font-bold tracking-wider uppercase text-[#ff5100]">
          WHAT WEAVE DOES
        </span>
        <h2 className="text-2xl sm:text-3xl lg:text-4xl font-black tracking-tight text-[#1d110c]">
          Everything your computer can do, now right in WhatsApp.
        </h2>
        <p className="text-sm sm:text-base text-[#59534E] leading-relaxed">
          You don't need to be sitting in front of your screen. Whether you're walking the dog, commuting, or cooking dinner—just send a message.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {features.map((feature, idx) => (
          <div
            key={idx}
            className="flex flex-col justify-between rounded-2xl border border-[#ead6cd] bg-[#fcf9f8] p-6 hover:border-[#ff5100]/50 hover:shadow-md transition-all group"
          >
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="size-12 rounded-xl bg-[#f4ebe6] flex items-center justify-center border border-[#ead6cd] group-hover:bg-[#ff5100]/10 transition-colors">
                  {feature.icon}
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-[#f4ebe6] text-[#a16245] tracking-wider">
                  {feature.badge}
                </span>
              </div>

              <div className="space-y-1.5">
                <h3 className="text-lg font-bold text-[#1d110c] tracking-tight">
                  {feature.title}
                </h3>
                <p className="text-sm text-[#59534E] leading-relaxed">
                  {feature.description}
                </p>
              </div>
            </div>

            <div className="mt-5 pt-4 border-t border-[#f4ebe6] flex items-center justify-between text-xs text-[#a16245]">
              <span className="italic font-medium truncate max-w-[85%]">{feature.example}</span>
              <ArrowRight className="size-4 text-[#ff5100] shrink-0 group-hover:translate-x-1 transition-transform" />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between p-4 rounded-xl bg-[#f4ebe6] border border-[#ead6cd] text-xs sm:text-sm font-semibold text-[#1d110c]">
        <div className="flex items-center gap-2">
          <Sparkles className="size-4 text-[#ff5100]" />
          <span>And hundreds of other tasks: drafting emails, creating spreadsheets, downloading videos, and reminders.</span>
        </div>
        <button
          onClick={onOpenDownload}
          className="text-[#ff5100] font-bold hover:underline shrink-0 ml-2"
        >
          Try It Free →
        </button>
      </div>
    </section>
  );
};
