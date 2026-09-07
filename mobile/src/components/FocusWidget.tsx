import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { HeadingText, CaptionText, DisplayText } from './Typography';

interface FocusWidgetProps {
  task: {
    title: string;
    deadline_at?: string | null;
    status: 'pending' | 'completed';
  } | null;
  onComplete: () => void;
}

export function FocusWidget({ task, onComplete }: FocusWidgetProps) {
  // If no task is present, render the calm, positive empty state
  if (!task) {
    return (
      <View
        className="bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-lg rounded-[24px] mb-lg flex-row items-center gap-md"
        style={styles.shadow}
      >
        <View className="w-10 h-10 rounded-full bg-success-light/10 dark:bg-success-dark/10 items-center justify-center">
          <DisplayText className="text-success-light dark:text-success-dark text-base">✓</DisplayText>
        </View>
        <View className="flex-1">
          <HeadingText className="font-bold text-sm text-textPrimary-light dark:text-textPrimary-dark">
            Nothing urgent right now
          </HeadingText>
          <CaptionText className="text-textSecondary-light dark:text-textSecondary-dark text-xs mt-0.5">
            You're completely on top of your deadlines.
          </CaptionText>
        </View>
      </View>
    );
  }

  const { title, deadline_at, status } = task;
  const isCompleted = status === 'completed';

  // Compute overdue status
  const isOverdue =
    status === 'pending' &&
    deadline_at &&
    new Date(deadline_at) < new Date();

  // Format time nicely
  const formatTime = (isoString?: string | null) => {
    if (!isoString) return 'All Day';
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return 'All Day';
    }
  };

  // Determine theme classes depending on urgency
  const accentColorClass = isOverdue
    ? 'text-accent-light dark:text-accent-dark'
    : 'text-primary-light dark:text-primary-dark';

  const accentBgClass = isOverdue
    ? 'bg-accent-light dark:bg-accent-dark'
    : 'bg-primary-light dark:bg-primary-dark';

  const accentBorderClass = isOverdue
    ? 'border-accent-light dark:border-accent-dark'
    : 'border-primary-light dark:border-primary-dark';

  // Calculate time remaining text
  const getRemainingText = () => {
    if (!deadline_at) return '--';
    const diffMs = new Date(deadline_at).getTime() - Date.now();
    if (diffMs < 0) return 'OVERDUE';
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    return `${Math.floor(diffHours / 24)}d`;
  };

  return (
    <View
      className="bg-card-light dark:bg-card-dark border border-border-light dark:border-border-dark p-xl rounded-[28px] mb-lg flex-col gap-lg"
      style={styles.shadow}
    >
      {/* Upper header section */}
      <View className="flex-row justify-between items-start">
        <View className="flex-1 mr-md">
          <CaptionText className={`font-extrabold uppercase tracking-wider text-xs ${accentColorClass}`}>
            ⚡ Focus Task
          </CaptionText>
          <HeadingText
            className={`font-black text-2xl mt-xs text-textPrimary-light dark:text-textPrimary-dark leading-8`}
          >
            {title}
          </HeadingText>
          <CaptionText className="text-textSecondary-light dark:text-textSecondary-dark mt-xs text-sm">
            ⏰ Due {formatTime(deadline_at)} {isOverdue && '• OVERDUE'}
          </CaptionText>
        </View>

        {/* Decorative Progress Ring Representation */}
        <View
          className={`w-14 h-14 rounded-full border-4 ${accentBorderClass} opacity-80 justify-center items-center`}
        >
          <View className="w-10 h-10 rounded-full border border-dashed border-textSecondary-light dark:border-textSecondary-dark justify-center items-center">
            <DisplayText className={`text-[10px] font-bold ${accentColorClass}`}>
              {getRemainingText()}
            </DisplayText>
          </View>
        </View>
      </View>

      {/* Primary Action Button */}
      <TouchableOpacity
        activeOpacity={0.8}
        onPress={onComplete}
        className={`w-full py-md rounded-2xl items-center justify-center flex-row gap-xs ${accentBgClass}`}
      >
        <DisplayText className="text-white font-bold text-base">
          ✓ Complete Focus Task
        </DisplayText>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 4,
  },
});
