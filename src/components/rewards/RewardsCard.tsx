
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Star, Trophy, Award, Medal } from 'lucide-react';
import { useRewards } from '@/hooks/useRewards';

const RewardsCard = () => {
  const { rewards, isLoading } = useRewards();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-6 flex items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </CardContent>
      </Card>
    );
  }

  if (!rewards) return null;

  const getTierIcon = (tier: string) => {
    switch (tier) {
      case 'platinum': return <Trophy className="h-5 w-5 text-[#003087]" />;
      case 'gold': return <Award className="h-5 w-5 text-yellow-600" />;
      case 'silver': return <Medal className="h-5 w-5 text-muted-foreground" />;
      default: return <Star className="h-5 w-5 text-amber-600" />;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'platinum': return 'bg-[#003087]/10 text-[#003087] border-[#003087]/20 dark:text-blue-300 dark:border-blue-400/30';
      case 'gold': return 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-500/15 dark:text-yellow-300 dark:border-yellow-500/30';
      case 'silver': return 'bg-muted text-muted-foreground border-border';
      default: return 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30';
    }
  };

  const progressPercentage = rewards.next_tier_threshold > 0 
    ? ((rewards.lifetime_points / rewards.next_tier_threshold) * 100)
    : 100;

  return (
    <Card className="bg-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between">
          <span className="text-lg">Rewards</span>
          <Badge variant="outline" className={getTierColor(rewards.tier)}>
            {getTierIcon(rewards.tier)}
            <span className="ml-1 capitalize">{rewards.tier}</span>
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <div className="text-3xl font-bold text-primary">{rewards.total_points}</div>
          <div className="text-sm text-muted-foreground">Available Points</div>
        </div>
        
        {rewards.tier !== 'platinum' && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress to {rewards.tier === 'bronze' ? 'Silver' : rewards.tier === 'silver' ? 'Gold' : 'Platinum'}</span>
              <span>{rewards.points_to_next_tier} points to go</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 pt-2">
          <div className="text-center">
            <div className="text-lg font-semibold">{rewards.lifetime_points}</div>
            <div className="text-xs text-muted-foreground">Lifetime Points</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold">{rewards.points_redeemed || 0}</div>
            <div className="text-xs text-muted-foreground">Points Redeemed</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default RewardsCard;
