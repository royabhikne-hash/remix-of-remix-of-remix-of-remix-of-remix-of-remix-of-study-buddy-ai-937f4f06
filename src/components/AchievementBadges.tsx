import { Trophy, Medal, Award, Crown, Star, Bell, TrendingUp, MapPin, School } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Achievement {
  id: string;
  achievement_type: string;
  achievement_title: string;
  achievement_description: string;
  badge_icon: string;
  achieved_at: string;
  ranking_type: string;
  rank_achieved: number;
  is_read: boolean;
  week_start: string;
}

interface RankNotification {
  id: string;
  notification_type: string;
  message: string;
  old_rank: number;
  new_rank: number;
  ranking_type: string;
  created_at: string;
  is_read: boolean;
}

interface AchievementBadgesProps {
  achievements: Achievement[];
  showAll?: boolean;
}

interface NotificationListProps {
  notifications: RankNotification[];
  onMarkAsRead?: (id: string) => void;
}

const getIcon = (iconName: string, rank?: number) => {
  const colorClass = rank === 1 ? "text-yellow-500" : rank === 2 ? "text-gray-400" : rank === 3 ? "text-amber-600" : "text-primary";
  
  switch (iconName) {
    case 'crown':
      return <Crown className={`w-5 h-5 ${colorClass}`} />;
    case 'trophy':
      return <Trophy className={`w-5 h-5 ${colorClass}`} />;
    case 'medal':
      return <Medal className={`w-5 h-5 ${colorClass}`} />;
    case 'award':
      return <Award className={`w-5 h-5 ${colorClass}`} />;
    default:
      return <Star className={`w-5 h-5 ${colorClass}`} />;
  }
};

const getBadgeClass = (rank: number, rankingType: string) => {
  const baseClass = rankingType === 'district' ? 'border-accent' : 'border-primary';
  
  if (rank === 1) return `bg-gradient-to-r from-yellow-400 to-amber-500 text-white border-0`;
  if (rank === 2) return `bg-gradient-to-r from-gray-300 to-gray-400 text-white border-0`;
  if (rank === 3) return `bg-gradient-to-r from-amber-500 to-orange-600 text-white border-0`;
  return `${baseClass} bg-background`;
};

export const AchievementBadges = ({ achievements, showAll = false }: AchievementBadgesProps) => {
  const displayAchievements = showAll ? achievements : achievements.slice(0, 6);

  if (achievements.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Trophy className="w-10 h-10 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No achievements yet</p>
        <p className="text-xs">Keep studying to earn badges!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {displayAchievements.map((achievement) => (
          <div
            key={achievement.id}
            className={`flex items-center gap-2 px-3 py-2 rounded-full border ${getBadgeClass(achievement.rank_achieved, achievement.ranking_type)} ${!achievement.is_read ? 'ring-2 ring-accent ring-offset-2' : ''}`}
            title={achievement.achievement_description}
          >
            {getIcon(achievement.badge_icon, achievement.rank_achieved)}
            <span className="text-xs font-medium">{achievement.achievement_title}</span>
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {achievement.ranking_type === 'district' ? <MapPin className="w-2.5 h-2.5 mr-0.5" /> : <School className="w-2.5 h-2.5 mr-0.5" />}
              {achievement.ranking_type}
            </Badge>
          </div>
        ))}
      </div>
      {!showAll && achievements.length > 6 && (
        <p className="text-xs text-muted-foreground text-center">
          +{achievements.length - 6} more achievements
        </p>
      )}
    </div>
  );
};

export const NotificationList = ({ notifications, onMarkAsRead }: NotificationListProps) => {
  if (notifications.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        <Bell className="w-10 h-10 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No notifications</p>
      </div>
    );
  }

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <div className="space-y-2">
      {notifications.map((notification) => (
        <div
          key={notification.id}
          className={`p-3 rounded-lg border ${!notification.is_read ? 'bg-accent/10 border-accent/30' : 'bg-muted/30 border-border'}`}
          onClick={() => !notification.is_read && onMarkAsRead?.(notification.id)}
        >
          <div className="flex items-start gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center ${notification.notification_type === 'entered_top_10' ? 'bg-accent/20' : 'bg-primary/20'}`}>
              {notification.notification_type === 'entered_top_10' ? (
                <Star className="w-4 h-4 text-accent" />
              ) : (
                <TrendingUp className="w-4 h-4 text-primary" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium">{notification.message}</p>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className="text-[10px]">
                  {notification.ranking_type === 'district' ? <MapPin className="w-2.5 h-2.5 mr-0.5" /> : <School className="w-2.5 h-2.5 mr-0.5" />}
                  {notification.ranking_type}
                </Badge>
                <span className="text-xs text-muted-foreground">{formatDate(notification.created_at)}</span>
              </div>
            </div>
            {!notification.is_read && (
              <div className="w-2 h-2 rounded-full bg-accent flex-shrink-0 mt-2" />
            )}
          </div>
        </div>
      ))}
    </div>
  );
};

export default AchievementBadges;