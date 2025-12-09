import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { DisputeList } from '@/components/disputes/DisputeList';

const Disputes = () => {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8 max-w-2xl">
        <h1 className="text-2xl font-bold mb-6">Transaction Disputes</h1>
        <DisputeList />
      </main>
      <Footer />
    </div>
  );
};

export default Disputes;
