import { Trophy, TrendingUp, Clock, Calendar, Medal, Award, Star, MapPin, School } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface RankInfo {
  rank: number;
  totalScore: number;
  improvementScore: number;
  dailyStudyTime: number;
  weeklyStudyDays: number;
}

interface RankingHistoryItem {
  week_start: string;
  week_end: string;
  school_rank: number | null;
  district_rank: number | null;
  total_score: number;
}

interface StudentRankingCardProps {
  mySchoolRank: RankInfo | null;
  myDistrictRank: RankInfo | null;
  totalSchoolStudents: number;
  totalDistrictStudents: number;
  schoolName: string;
  district: string;
  rankingHistory?: RankingHistoryItem[];
}

const StudentRankingCard = ({
  mySchoolRank,
  myDistrictRank,
  totalSchoolStudents,
  totalDistrictStudents,
  schoolName,
  district,
  rankingHistory = [],
}: StudentRankingCardProps) => {
  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="w-6 h-6 text-yellow-500" />;
      case 2:
        return <Medal className="w-6 h-6 text-gray-400" />;
      case 3:
        return <Award className="w-6 h-6 text-amber-600" />;
      default:
        return <Star className="w-6 h-6 text-primary" />;
    }
  };

  const getRankBadgeClass = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-gradient-to-r from-yellow-400 to-amber-500 text-white shadow-lg";
      case 2:
        return "bg-gradient-to-r from-gray-300 to-gray-400 text-white";
      case 3:
        return "bg-gradient-to-r from-amber-500 to-orange-600 text-white";
      default:
        return "bg-primary text-primary-foreground";
    }
  };

  const formatStudyTime = (minutes: number) => {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const mins = minutes % 60;
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${minutes}m`;
  };

  const formatWeekDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
    });
  };

  const RankDisplay = ({ 
    rank, 
    total, 
    label, 
    icon,
    rankInfo 
  }: { 
    rank: number | null; 
    total: number; 
    label: string;
    icon: React.ReactNode;
    rankInfo: RankInfo | null;
  }) => {
    if (!rank || !rankInfo) {
      return (
        <div className="edu-card p-4 text-center">
          <div className="text-muted-foreground mb-2">{icon}</div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-lg font-medium text-muted-foreground">No rank yet</p>
        </div>
      );
    }

    return (
      <div className="edu-card p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-14 h-14 rounded-full flex items-center justify-center ${getRankBadgeClass(rank)}`}>
            {rank <= 3 ? getRankIcon(rank) : <span className="text-xl font-bold">#{rank}</span>}
          </div>
          <div>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              {icon}
              {label}
            </p>
            <p className="text-2xl font-bold text-foreground">
              #{rank} <span className="text-sm font-normal text-muted-foreground">of {total}</span>
            </p>
          </div>
        </div>
        
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 bg-secondary/50 rounded-lg">
            <div className="flex items-center justify-center gap-1 text-accent mb-1">
              <TrendingUp className="w-3 h-3" />
            </div>
            <p className="text-lg font-bold">{rankInfo.improvementScore}%</p>
            <p className="text-[10px] text-muted-foreground">Score</p>
          </div>
          <div className="p-2 bg-secondary/50 rounded-lg">
            <div className="flex items-center justify-center gap-1 text-primary mb-1">
              <Clock className="w-3 h-3" />
            </div>
            <p className="text-lg font-bold">{formatStudyTime(rankInfo.dailyStudyTime)}</p>
            <p className="text-[10px] text-muted-foreground">Today</p>
          </div>
          <div className="p-2 bg-secondary/50 rounded-lg">
            <div className="flex items-center justify-center gap-1 text-warning mb-1">
              <Calendar className="w-3 h-3" />
            </div>
            <p className="text-lg font-bold">{rankInfo.weeklyStudyDays}/7</p>
            <p className="text-[10px] text-muted-foreground">Days</p>
          </div>
        </div>
        
        <div className="mt-3 pt-3 border-t border-border text-center">
          <p className="text-lg font-bold text-primary">{rankInfo.totalScore} points</p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="edu-card p-4 bg-gradient-to-r from-primary/10 via-accent/10 to-primary/10">
        <div className="flex items-center gap-2 mb-2">
          <Trophy className="w-5 h-5 text-primary" />
          <h2 className="font-bold text-lg">Your Ranking</h2>
        </div>
        <p className="text-xs text-muted-foreground">
          Based on improvement score, daily study time & weekly consistency
        </p>
      </div>

      <Tabs defaultValue="school" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="school" className="flex items-center gap-1 text-xs sm:text-sm">
            <School className="w-3 h-3 sm:w-4 sm:h-4" />
            School
          </TabsTrigger>
          <TabsTrigger value="district" className="flex items-center gap-1 text-xs sm:text-sm">
            <MapPin className="w-3 h-3 sm:w-4 sm:h-4" />
            District
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="school" className="mt-4">
          <RankDisplay
            rank={mySchoolRank?.rank || null}
            total={totalSchoolStudents}
            label={schoolName}
            icon={<School className="w-4 h-4" />}
            rankInfo={mySchoolRank}
          />
        </TabsContent>
        
        <TabsContent value="district" className="mt-4">
          <RankDisplay
            rank={myDistrictRank?.rank || null}
            total={totalDistrictStudents}
            label={district}
            icon={<MapPin className="w-4 h-4" />}
            rankInfo={myDistrictRank}
          />
        </TabsContent>
      </Tabs>

      {/* Ranking History */}
      {rankingHistory.length > 0 && (
        <div className="edu-card overflow-hidden">
          <div className="p-3 border-b border-border bg-secondary/30">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              Weekly History
            </h3>
          </div>
          <div className="divide-y divide-border">
            {rankingHistory.slice(0, 5).map((history, index) => (
              <div key={index} className="p-3 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {formatWeekDate(history.week_start)} - {formatWeekDate(history.week_end)}
                </span>
                <div className="flex items-center gap-4">
                  {history.school_rank && (
                    <span className="flex items-center gap-1">
                      <School className="w-3 h-3 text-primary" />
                      #{history.school_rank}
                    </span>
                  )}
                  {history.district_rank && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 text-accent" />
                      #{history.district_rank}
                    </span>
                  )}
                  <span className="font-medium">{history.total_score} pts</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default StudentRankingCard;