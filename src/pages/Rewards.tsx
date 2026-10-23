
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
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <main className="flex-1 pt-6 pb-16 px-4 sm:px-6 max-w-[1200px] mx-auto w-full">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-[28px] leading-tight font-display font-semibold">Rewards Program</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          <div className="lg:col-span-1">
            <RewardsCard />
          </div>
          
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">How It Works</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                    <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">Earn Points</h3>
                    <p className="text-sm text-blue-700 dark:text-blue-300">Get 1 point for every K10 spent. Bonus points for Food & Transportation!</p>
                  </div>
                  <div className="p-4 bg-green-50 dark:bg-green-500/10 rounded-lg">
                    <h3 className="font-semibold text-green-900 dark:text-green-200 mb-2">Tier Benefits</h3>
                    <p className="text-sm text-green-700 dark:text-green-300">Advance through Bronze, Silver, Gold, and Platinum tiers for exclusive perks.</p>
                  </div>
                  <div className="p-4 bg-accent rounded-2xl">
                    <h3 className="font-semibold text-foreground mb-2">Redeem Rewards</h3>
                    <p className="text-sm text-muted-foreground">Redemption isn't available yet. Your points balance is tracked above, and redemption options will be announced here when they launch — points can't be spent today.</p>
                  </div>
                  <div className="p-4 bg-amber-50 dark:bg-amber-500/10 rounded-lg">
                    <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-2">Stay Active</h3>
                    <p className="text-sm text-amber-700 dark:text-amber-300">Keep earning to maintain your tier status and unlock new benefits.</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            ) : rewardTransactions && rewardTransactions.length > 0 ? (
              <div className="divide-y divide-border">
                {rewardTransactions.map((transaction) => (
                  <div key={transaction.id} className="flex items-center justify-between py-4 first:pt-0 last:pb-0">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
                        transaction.action_type === 'earn' ? 'bg-green-100 dark:bg-green-500/15' : 'bg-red-100 dark:bg-red-500/15'
                      }`}>
                        {transaction.action_type === 'earn' ? (
                          <Plus className="h-4 w-4 text-green-600 dark:text-green-400" />
                        ) : (
                          <Minus className="h-4 w-4 text-red-600 dark:text-red-400" />
                        )}
                      </div>
                      <div>
                        <div className="font-medium text-[15px]">
                          {transaction.description || 'Reward transaction'}
                        </div>
                        <div className="text-[13px] text-muted-foreground">
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
