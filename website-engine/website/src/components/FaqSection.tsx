import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export const FaqSection: React.FC = () => {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const faqs = [
    {
      q: 'Do I need to know how to code or be a tech expert?',
      a: 'No, absolutely not! Weave was designed for anyone who uses WhatsApp. If you know how to send a text or voice note, you can use Weave. Just speak naturally, and Weave takes care of the rest on your computer.'
    },
    {
      q: 'Is my personal data and payment info safe?',
      a: '100% safe. Weave runs directly on your personal computer. We have zero cloud servers collecting or storing your chats, files, or payment info. Everything stays strictly inside your computer’s memory.'
    },
    {
      q: 'How much does Weave cost?',
      a: 'Weave is 100% free and open-source. There are no surprise subscriptions, hidden fees, or credit cards required.'
    },
    {
      q: 'Does my computer need to stay turned on?',
      a: 'Yes, Weave acts like an assistant working at your desk. As long as your laptop or computer is on and connected to the internet, you can text it from anywhere in the world while commuting, shopping, or traveling.'
    },
    {
      q: 'What can I ask it to do?',
      a: 'Almost anything you normally do on a browser or computer: booking rides on Uber, reserving hotels, making a landing page or website for your business, reordering food, summarizing documents, or checking flight statuses.'
    }
  ];

  return (
    <section className="py-12 border-t border-[#ead6cd]/70 max-w-3xl mx-auto font-sans w-full" id="faq">
      <div className="flex flex-col gap-2 mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#1d110c]">
          Frequently Asked Questions
        </h2>
        <p className="text-base text-[#59534E]">
          Everything you need to know about getting started.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {faqs.map((faq, idx) => {
          const isOpen = openIndex === idx;
          return (
            <div
              key={idx}
              className={`rounded-2xl border transition-all duration-200 overflow-hidden ${
                isOpen
                  ? 'border-[#ff5100] bg-white shadow-xs'
                  : 'border-[#ead6cd] bg-white hover:border-[#d3cec2]'
              }`}
            >
              <button
                onClick={() => setOpenIndex(isOpen ? null : idx)}
                className="w-full p-5 text-left flex items-center justify-between gap-4 font-semibold text-[#1d110c] text-base cursor-pointer"
              >
                <span>{faq.q}</span>
                <span className="text-[#ff5100] shrink-0">
                  {isOpen ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
                </span>
              </button>

              {isOpen && (
                <div className="px-5 pb-5 text-sm text-[#59534E] leading-relaxed border-t border-[#f4ebe6] pt-3 animate-fadeIn">
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
