import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import Header from "@/components/Header";
import Footer from "@/components/Footer";

interface PageSkeletonProps {
  cards?: number;
  showHeader?: boolean;
  showChart?: boolean;
  title?: boolean;
}

const PageSkeleton = ({ cards = 3, showHeader = true, showChart = false, title = true }: PageSkeletonProps) => (
  <div className="min-h-screen flex flex-col bg-background">
    {showHeader && <Header />}
    <main className="flex-1 pt-24 pb-16 px-4 max-w-6xl mx-auto w-full">
      {title && (
        <div className="mb-8">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-5 w-72" />
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {[...Array(cards)].map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      {showChart && <Skeleton className="h-64 rounded-xl mb-6" />}
      <Card>
        <CardContent className="pt-6 space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-40 mb-1" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
    {showHeader && <Footer />}
  </div>
);

export default PageSkeleton;
