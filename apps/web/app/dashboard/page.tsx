"use client";

import { Button } from "@/components/ui/button";
import { DashboardDatePicker } from "@/components/DashboardDatePicker";
import { MemoryForm } from "@/components/MemoryForm";
import { DashboardAiSummarySection } from "@/components/dashboard/dashboard-ai-summary-section";
import { DashboardDataSourcesSection } from "@/components/dashboard/dashboard-data-sources-section";
import { DashboardDayMetaSections } from "@/components/dashboard/dashboard-day-meta-sections";
import { DashboardLoadingSkeleton } from "@/components/dashboard/dashboard-skeletons";
import { DashboardMemoriesSection } from "@/components/dashboard/dashboard-memories-section";
import { DashboardQuickStats } from "@/components/dashboard/dashboard-quick-stats";
import { useDashboardPage } from "@/hooks/useDashboardPage";

export default function DashboardPage() {
  const {
    isLoading,
    selectedDate,
    setSelectedDate,
    dayKey,
    showMemoryForm,
    editingMemory,
    isGeneratingSummary,
    summaryGenerationError,
    summary,
    isSummaryLoading,
    memoriesWithThumbnail,
    isMemoriesLoading,
    canLoadMoreMemories,
    isLoadingMoreMemories,
    hasSummarySourceData,
    day,
    integrationDailyData,
    latestMemoryMood,
    sourceRows,
    providerLabelMap,
    metricItems,
    handleEditMemory,
    handleFormSuccess,
    handleFormCancel,
    handleDeleteSuccess,
    handleGenerateSummary,
    loadMoreMemoriesPage,
    openNewMemoryForm,
  } = useDashboardPage();

  if (isLoading) return <DashboardLoadingSkeleton />;

  return (
    <div className="max-w-2xl pb-4">
      <DashboardDatePicker
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <DashboardQuickStats
        latestMemoryMood={latestMemoryMood}
        memoryCount={memoriesWithThumbnail.length}
        dayKey={dayKey}
        dayRating={day?.rating}
      />

      <DashboardAiSummarySection
        summary={summary}
        isSummaryLoading={isSummaryLoading}
        isGeneratingSummary={isGeneratingSummary}
        hasSummarySourceData={hasSummarySourceData}
        summaryGenerationError={summaryGenerationError}
        metricItems={metricItems}
        onGenerateSummary={handleGenerateSummary}
      />

      <DashboardDataSourcesSection
        integrationDailyData={integrationDailyData}
        sourceRows={sourceRows}
        providerLabelMap={providerLabelMap}
      />

      {showMemoryForm && (
        <MemoryForm
          dayKey={dayKey}
          memoryId={editingMemory?._id}
          initialData={
            editingMemory
              ? {
                  title: editingMemory.title,
                  description: editingMemory.description,
                  mood: editingMemory.mood,
                  happenedAt: editingMemory.happenedAt,
                }
              : undefined
          }
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
        />
      )}

      {!showMemoryForm && (
        <Button onClick={openNewMemoryForm} className="mb-8">
          + Add Memory
        </Button>
      )}

      <DashboardMemoriesSection
        isMemoriesLoading={isMemoriesLoading}
        memories={memoriesWithThumbnail}
        canLoadMoreMemories={canLoadMoreMemories}
        isLoadingMoreMemories={isLoadingMoreMemories}
        onLoadMore={loadMoreMemoriesPage}
        onEditMemory={handleEditMemory}
        onDeleteSuccess={handleDeleteSuccess}
      />

      <DashboardDayMetaSections day={day} />
    </div>
  );
}
