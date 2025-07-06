
import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCategories } from '@/hooks/useCategories';
import * as Icons from 'lucide-react';

interface CategorySelectProps {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
}

const CategorySelect = ({ value, onValueChange, placeholder = "Select category" }: CategorySelectProps) => {
  const { data: categories, isLoading } = useCategories();

  if (isLoading) {
    return (
      <Select disabled>
        <SelectTrigger>
          <SelectValue placeholder="Loading categories..." />
        </SelectTrigger>
      </Select>
    );
  }

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {categories?.map((category) => {
          const IconComponent = category.icon && Icons[category.icon as keyof typeof Icons] 
            ? Icons[category.icon as keyof typeof Icons] as React.ComponentType<any>
            : Icons.Circle;
            
          return (
            <SelectItem key={category.id} value={category.name}>
              <div className="flex items-center gap-2">
                <IconComponent className="h-4 w-4" style={{ color: category.color }} />
                <span>{category.name}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
};

export default CategorySelect;
