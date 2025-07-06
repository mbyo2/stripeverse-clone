
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
      case 'platinum': return <Trophy className="h-5 w-5 text-purple-600" />;
      case 'gold': return <Award className="h-5 w-5 text-yellow-600" />;
      case 'silver': return <Medal className="h-5 w-5 text-gray-600" />;
      default: return <Star className="h-5 w-5 text-amber-600" />;
    }
  };

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'platinum': return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'gold': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'silver': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-amber-100 text-amber-800 border-amber-200';
    }
  };

  const progressPercentage = rewards.next_tier_threshold > 0 
    ? ((rewards.lifetime_points / rewards.next_tier_threshold) * 100)
    : 100;

  return (
    <Card className="bg-gradient-to-br from-blue-50 to-purple-50">
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
