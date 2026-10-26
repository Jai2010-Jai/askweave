import { Lock, Smartphone, Mic } from 'lucide-react';

export const WhyWeave: React.FC = () => {
  const benefits = [
    {
      icon: <Lock className="size-5 text-emerald-700" />,
      title: '100% Private on Your Computer',
      description: 'Unlike cloud AIs that store your conversations and credit cards on their servers, Weave runs completely on your physical machine. Your files, logins, and messages never leave your hardware.'
    },
    {
      icon: <Smartphone className="size-5 text-[#ff5100]" />,
      title: 'Zero New Apps to Install',
      description: 'You already use WhatsApp dozens of times a day. There are no new apps eating your phone storage, no complex menus to learn, and no extra notifications.'
    },
    {
      icon: <Mic className="size-5 text-[#ff5100]" />,
      title: 'Voice Notes Supported',
      description: 'Too busy to type? Just press and hold the mic button while walking, cooking, or driving. Weave understands natural everyday speech and takes care of the rest.'
    }
  ];

  return (
    <section className="py-12 border-t border-[#ead6cd]/70 max-w-3xl mx-auto font-sans" id="privacy">
      <div className="flex flex-col gap-2 mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d110c]">
          Built for everyday life.
        </h2>
        <p className="text-base text-[#59534E]">
          Simple, respectful technology that works the way you already do.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {benefits.map((b, idx) => (
          <div
            key={idx}
            className="flex flex-col gap-3 rounded-2xl border border-[#ead6cd] bg-white p-6 shadow-xs"
          >
            <div className="size-10 rounded-xl bg-[#f4ebe6] flex items-center justify-center">
              {b.icon}
            </div>
            <h3 className="text-base font-bold text-[#1d110c]">
              {b.title}
            </h3>
            <p className="text-xs sm:text-sm text-[#59534E] leading-relaxed">
              {b.description}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
};
