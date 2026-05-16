"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Zap, 
  Box, 
  Users,
  Cpu,
  Activity
} from "lucide-react";
import type { StatCardData } from "@/lib/types";

const getIcon = (title: string) => {
  const t = title.toLowerCase();
  if (t.includes("cost") || t.includes("비용") || t.includes("spend")) return <DollarSign className="w-4 h-4" />;
  if (t.includes("token") || t.includes("토큰")) return <Zap className="w-4 h-4" />;
  if (t.includes("container") || t.includes("컨테이너") || t.includes("task")) return <Box className="w-4 h-4" />;
  if (t.includes("user") || t.includes("사용자")) return <Users className="w-4 h-4" />;
  if (t.includes("cpu") || t.includes("mem")) return <Cpu className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
};

export default function StatCard({ title, value, description, trend }: StatCardData) {
  const isPositive = trend?.isPositive;
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      className="relative overflow-hidden group bg-[#161b22]/40 backdrop-blur-md rounded-2xl border border-white/5 p-6 shadow-2xl transition-all duration-300 hover:border-primary-500/30 hover:shadow-primary-500/10"
    >
      {/* Background Glow */}
      <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary-500/5 blur-3xl rounded-full group-hover:bg-primary-500/10 transition-colors duration-500" />
      
      <div className="relative flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-primary-500/10 text-primary-400">
            {getIcon(title)}
          </div>
          <span className="text-[11px] font-bold text-gray-400 uppercase tracking-[0.15em]">
            {title}
          </span>
        </div>
        
        {trend && (
          <div className={cn(
            "flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold",
            isPositive 
              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
              : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
          )}>
            {isPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {isPositive ? "+" : ""}{trend.value}%
          </div>
        )}
      </div>

      <div className="relative flex flex-col">
        <span className="text-3xl font-black text-white tracking-tight leading-none mb-1">
          {value}
        </span>
        {description && (
          <span className="text-xs text-gray-500 font-medium tracking-wide">
            {description}
          </span>
        )}
      </div>
      
      {/* Decorative Bottom Bar */}
      <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-primary-500/0 to-transparent group-hover:via-primary-500/40 transition-all duration-500" />
    </motion.div>
  );
}
