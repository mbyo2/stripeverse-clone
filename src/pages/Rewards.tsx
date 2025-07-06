
import React from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import RewardsCard from '@/components/rewards/RewardsCard';
import { useRewards } from '@/hooks/useRewards';
import { formatDate } from '@/lib/utils';
import { Plus, Minus } from 'lucide-react';

const Rewards = () => {
  const { rewardTransactions, isLoading } = useRewards();

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-blue-50 to-purple-50">
      <Header />
      <main className="flex-1 pt-24 pb-16 px-4 max-w-7xl mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold">Rewards Program</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-1">
            <RewardsCard />
          </div>
          
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle>How It Works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 rounded-lg">
                    <h3 className="font-semibold text-blue-900 mb-2">Earn Points</h3>
                    <p className="text-sm text-blue-700">Get 1 point for every K10 spent. Bonus points for Food & Transportation!</p>
                  </div>
                  <div className="p-4 bg-green-50 rounded-lg">
                    <h3 className="font-semibold text-green-900 mb-2">Tier Benefits</h3>
                    <p className="text-sm text-green-700">Advance through Bronze, Silver, Gold, and Platinum tiers for exclusive perks.</p>
                  </div>
                  <div className="p-4 bg-purple-50 rounded-lg">
                    <h3 className="font-semibold text-purple-900 mb-2">Redeem Rewards</h3>
                    <p className="text-sm text-purple-700">Use points for cashback, discounts, and special offers.</p>
                  </div>
                  <div className="p-4 bg-amber-50 rounded-lg">
                    <h3 className="font-semibold text-amber-900 mb-2">Stay Active</h3>
                    <p className="text-sm text-amber-700">Keep earning to maintain your tier status and unlock new benefits.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : rewardTransactions && rewardTransactions.length > 0 ? (
              <div className="space-y-4">
                {rewardTransactions.map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between py-3 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                        transaction.action_type === 'earn' ? 'bg-green-100' : 'bg-red-100'
                      }`}>
                        {transaction.action_type === 'earn' ? (
                          <Plus className="h-4 w-4 text-green-600" />
                        ) : (
                          <Minus className="h-4 w-4 text-red-600" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium">
                          {transaction.description || 'Reward transaction'}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {formatDate(transaction.created_at)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={transaction.action_type === 'earn' ? 'default' : 'secondary'}>
                        {transaction.action_type === 'earn' ? '+' : '-'}
                        {transaction.points_earned || transaction.points_spent} points
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>No reward activity yet</p>
                <p className="text-sm mt-2">Start making transactions to earn points!</p>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
      <Footer />
    </div>
  );
};

export default Rewards;
