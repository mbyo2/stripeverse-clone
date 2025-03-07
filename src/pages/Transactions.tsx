
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import { ArrowDownLeft, ArrowUpRight, Download, Search } from "lucide-react";

// Generate mock transactions
const generateTransactions = (count: number) => {
  const types = ["sent", "received"];
  const names = ["John Mulenga", "Mary Phiri", "MTN Mobile", "Airtel Money", "Zanaco Bank", "Shoprite", "ZESCO", "Water Utility"];
  const transactions = [];
  
  const today = new Date();
  
  for (let i = 0; i < count; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() - Math.floor(Math.random() * 30));
    
    transactions.push({
      id: i + 1,
      type: types[Math.floor(Math.random() * types.length)],
      name: names[Math.floor(Math.random() * names.length)],
      amount: (Math.random() * 500 + 10).toFixed(2),
      date: date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
      time: `${Math.floor(Math.random() * 12) + 1}:${Math.floor(Math.random() * 60).toString().padStart(2, '0')} ${Math.random() > 0.5 ? 'AM' : 'PM'}`,
      status: Math.random() > 0.9 ? "pending" : "completed",
      category: ["Bills", "Shopping", "Transfer", "Food", "Transport"][Math.floor(Math.random() * 5)]
    });
  }
  
  // Sort by date (newest first)
  return transactions.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
};

const mockTransactions = generateTransactions(20);

const Transactions = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterType, setFilterType] = useState("all");
  
  const filteredTransactions = mockTransactions.filter(transaction => {
    const matchesSearch = transaction.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         transaction.amount.includes(searchTerm);
    
    const matchesFilter = filterType === "all" || 
                         (filterType === "incoming" && transaction.type === "received") ||
                         (filterType === "outgoing" && transaction.type === "sent");
    
    return matchesSearch && matchesFilter;
  });
  
  // Group transactions by date
  const groupedTransactions: Record<string, typeof mockTransactions> = {};
  
  filteredTransactions.forEach(transaction => {
    if (!groupedTransactions[transaction.date]) {
      groupedTransactions[transaction.date] = [];
    }
    groupedTransactions[transaction.date].push(transaction);
  });

  return (
    <div className="min-h-screen flex flex-col bg-secondary/10">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <h1 className="text-3xl font-bold">Transaction History</h1>
          <Button variant="outline">
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
        
        {/* Filters */}
        <div className="flex flex-col md:flex-row gap-4 mb-8">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input 
              placeholder="Search transactions..." 
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-full md:w-[180px]">
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Transactions</SelectItem>
              <SelectItem value="incoming">Incoming</SelectItem>
              <SelectItem value="outgoing">Outgoing</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Transactions List */}
        {Object.keys(groupedTransactions).length > 0 ? (
          Object.entries(groupedTransactions).map(([date, transactions]) => (
            <div key={date} className="mb-6">
              <h3 className="text-sm font-medium text-muted-foreground mb-2">{date}</h3>
              <Card>
                <CardContent className="p-0">
                  {transactions.map((transaction, index) => (
                    <div 
                      key={transaction.id} 
                      className={`flex items-center justify-between p-4 ${
                        index !== transactions.length - 1 ? "border-b" : ""
                      }`}
                    >
                      <div className="flex items-center">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                          transaction.type === "sent" ? "bg-red-100" : "bg-green-100"
                        }`}>
                          {transaction.type === "sent" ? (
                            <ArrowUpRight className="h-5 w-5 text-red-600" />
                          ) : (
                            <ArrowDownLeft className="h-5 w-5 text-green-600" />
                          )}
                        </div>
                        <div className="ml-4">
                          <div className="font-medium">{transaction.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {transaction.time} • {transaction.category}
                            {transaction.status === "pending" && (
                              <span className="ml-2 text-yellow-600 font-medium">Pending</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className={`font-medium ${
                        transaction.type === "sent" ? "text-red-600" : "text-green-600"
                      }`}>
                        {transaction.type === "sent" ? "-" : "+"}K {transaction.amount}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          ))
        ) : (
          <Card className="text-center py-12">
            <CardContent>
              <p className="text-muted-foreground">No transactions found matching your criteria.</p>
            </CardContent>
          </Card>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default Transactions;
