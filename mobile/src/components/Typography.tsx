import React from 'react';
import { Text, TextProps } from 'react-native';

export type TextComponentProps = TextProps & {
  children: React.ReactNode;
  className?: string;
};

export function DisplayText({ children, className = '', ...props }: TextComponentProps) {
  return (
    <Text
      className={`font-interBold text-[28px] leading-[34px] text-textPrimary-light dark:text-textPrimary-dark ${className}`}
      {...props}
    >
      {children}
    </Text>
  );
}

export function HeadingText({ children, className = '', ...props }: TextComponentProps) {
  return (
    <Text
      className={`font-interBold text-[18px] leading-[24px] text-textPrimary-light dark:text-textPrimary-dark ${className}`}
      {...props}
    >
      {children}
    </Text>
  );
}

export function BodyText({ children, className = '', ...props }: TextComponentProps) {
  return (
    <Text
      className={`font-inter text-[15px] leading-[22px] text-textSecondary-light dark:text-textSecondary-dark ${className}`}
      {...props}
    >
      {children}
    </Text>
  );
}

export function CaptionText({ children, className = '', ...props }: TextComponentProps) {
  return (
    <Text
      className={`font-inter text-[13px] leading-[18px] text-textSecondary-light dark:text-textSecondary-dark ${className}`}
      {...props}
    >
      {children}
    </Text>
  );
}
