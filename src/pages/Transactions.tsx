
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import TransactionManager from "@/components/wallet/TransactionManager";

const Transactions = () => {
  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h1 className="text-3xl font-bold">Transaction History</h1>
        </div>
        
        <TransactionManager showFilters={true} showExport={true} />
      </main>
      <Footer />
    </div>
  );
};

export default Transactions;
