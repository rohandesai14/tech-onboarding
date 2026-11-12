
import type { Assignment } from "./db.js";
import { collections } from "./db.js";

export type AssignResult =
  | { kind: "assigned"; assignment: Assignment }
  | { kind: "judge-busy" }
  | { kind: "none-available" };

export async function assignNext(judgeId: string): Promise<AssignResult> {
  const { projects, assignments } = collections();

  // 1. Check whether this judge already has a queued assignment.
  const currentAssignment = await assignments.findOne({
    judgeId,
    status: "QUEUED",
  });

  if (currentAssignment) {
    return { kind: "judge-busy" };
  }

  // 2. Get every project this judge has previously been assigned.
  const previousAssignments = await assignments
    .find({ judgeId })
    .toArray();

  const previouslyAssigned = new Set(
    previousAssignments.map((assignment) => assignment.projectId)
  );

  // 3. Get projects currently queued for other judges.
  const queuedAssignments = await assignments
    .find({
      status: "QUEUED",
      judgeId: { $ne: judgeId },
    })
    .toArray();

  const currentlyQueued = new Set(
    queuedAssignments.map((assignment) => assignment.projectId)
  );

  // 4. Find projects that are available to this judge.
  const allProjects = await projects.find({}).toArray();

  const availableProjects = allProjects.filter(
    (project) =>
      !previouslyAssigned.has(project._id) &&
      !currentlyQueued.has(project._id)
  );

  if (availableProjects.length === 0) {
    return { kind: "none-available" };
  }

  // 5. Count completed assignments for each available project.
  const projectCounts = await Promise.all(
    availableProjects.map(async (project) => ({
      project,
      count: await assignments.countDocuments({
        projectId: project._id,
        status: "COMPLETED",
      }),
    }))
  );

  // 6. Find the smallest completed-assignment count.
  const minimumCount = Math.min(
    ...projectCounts.map((item) => item.count)
  );

  // 7. Randomly choose among projects tied for the smallest count.
  const leastAssignedProjects = projectCounts.filter(
    (item) => item.count === minimumCount
  );

  const selected =
    leastAssignedProjects[
      Math.floor(Math.random() * leastAssignedProjects.length)
    ].project;

  // 8. Create the new queued assignment.
  const newAssignment = {
    judgeId,
    projectId: selected._id,
    status: "QUEUED" as const,
    createdAt: new Date(),
  };

  const result = await assignments.insertOne(newAssignment);

  return {
    kind: "assigned",
    assignment: {
      ...newAssignment,
      _id: result.insertedId,
    },
  };
}
