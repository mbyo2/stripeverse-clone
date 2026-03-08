import { useLanguage, Language } from '@/contexts/LanguageContext';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Globe } from 'lucide-react';

const flags: Record<Language, string> = { en: '🇬🇧', fr: '🇫🇷', pt: '🇵🇹' };

export const LanguageSelector = ({ compact }: { compact?: boolean }) => {
  const { language, setLanguage, languages } = useLanguage();

  return (
    <Select value={language} onValueChange={(v) => setLanguage(v as Language)}>
      <SelectTrigger className={compact ? "w-[70px] h-9" : "w-[140px]"}>
        <SelectValue>
          {compact ? flags[language] : `${flags[language]} ${languages[language]}`}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(languages) as Language[]).map(lang => (
          <SelectItem key={lang} value={lang}>
            {flags[lang]} {languages[lang]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
