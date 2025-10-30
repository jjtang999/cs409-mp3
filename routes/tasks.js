var Task = require('../models/task');
var User = require('../models/user');

module.exports = function (router) {

    // Tasks collection routes
    var tasksRoute = router.route('/tasks');

    // GET /api/tasks - Get all tasks with query parameters
    tasksRoute.get(function (req, res) {
        try {
            // Parse query parameters
            var query = {};
            var sort = {};
            var select = {};
            var skip = 0;
            var limit = 100;
            var count = false;

            if (req.query.where) {
                try {
                    query = JSON.parse(req.query.where);
                } catch (e) {
                    return res.status(400).json({
                        message: "Invalid JSON in 'where' parameter",
                        data: {}
                    });
                }
            }

            if (req.query.sort) {
                try {
                    sort = JSON.parse(req.query.sort);
                } catch (e) {
                    return res.status(400).json({
                        message: "Invalid JSON in 'sort' parameter",
                        data: {}
                    });
                }
            }

            if (req.query.select) {
                try {
                    select = JSON.parse(req.query.select);
                } catch (e) {
                    return res.status(400).json({
                        message: "Invalid JSON in 'select' parameter",
                        data: {}
                    });
                }
            }

            if (req.query.skip) {
                skip = parseInt(req.query.skip);
            }

            if (req.query.limit) {
                limit = parseInt(req.query.limit);
            }

            if (req.query.count) {
                count = req.query.count === 'true';
            }

            // If count is requested, return the count
            if (count) {
                Task.countDocuments(query, function (err, result) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error counting tasks",
                            data: {}
                        });
                    }
                    return res.status(200).json({
                        message: "OK",
                        data: result
                    });
                });
            } else {
                // Build query
                var dbQuery = Task.find(query).sort(sort).select(select).skip(skip).limit(limit);

                dbQuery.exec(function (err, tasks) {
                    if (err) {
                        return res.status(500).json({
                            message: "Error retrieving tasks",
                            data: {}
                        });
                    }
                    return res.status(200).json({
                        message: "OK",
                        data: tasks
                    });
                });
            }
        } catch (error) {
            return res.status(500).json({
                message: "Server error",
                data: {}
            });
        }
    });

    // POST /api/tasks - Create a new task
    tasksRoute.post(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Name and deadline are required",
                data: {}
            });
        }

        var task = new Task();
        task.name = req.body.name;
        task.description = req.body.description || "";
        task.deadline = req.body.deadline;
        task.completed = req.body.completed !== undefined ? req.body.completed : false;
        task.assignedUser = req.body.assignedUser || "";
        task.assignedUserName = req.body.assignedUserName || "unassigned";

        task.save(function (err, savedTask) {
            if (err) {
                return res.status(500).json({
                    message: "Error creating task",
                    data: {}
                });
            }

            // If task is assigned to a user, update user's pendingTasks
            if (savedTask.assignedUser && savedTask.assignedUser !== "" && !savedTask.completed) {
                User.findById(savedTask.assignedUser, function (err, user) {
                    if (err || !user) {
                        // User doesn't exist, but task was already saved, so we just return the task
                        return res.status(201).json({
                            message: "Task created",
                            data: savedTask
                        });
                    }
                    
                    if (user.pendingTasks.indexOf(savedTask._id.toString()) === -1) {
                        user.pendingTasks.push(savedTask._id.toString());
                        user.save(function (err) {
                            if (err) {
                                console.error("Error updating user's pending tasks:", err);
                            }
                        });
                    }
                    
                    return res.status(201).json({
                        message: "Task created",
                        data: savedTask
                    });
                });
            } else {
                return res.status(201).json({
                    message: "Task created",
                    data: savedTask
                });
            }
        });
    });

    // Single task routes
    var taskRoute = router.route('/tasks/:id');

    // GET /api/tasks/:id - Get a specific task
    taskRoute.get(function (req, res) {
        var select = {};

        if (req.query.select) {
            try {
                select = JSON.parse(req.query.select);
            } catch (e) {
                return res.status(400).json({
                    message: "Invalid JSON in 'select' parameter",
                    data: {}
                });
            }
        }

        Task.findById(req.params.id).select(select).exec(function (err, task) {
            if (err) {
                return res.status(500).json({
                    message: "Error retrieving task",
                    data: {}
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Task not found",
                    data: {}
                });
            }
            return res.status(200).json({
                message: "OK",
                data: task
            });
        });
    });

    // PUT /api/tasks/:id - Replace a task
    taskRoute.put(function (req, res) {
        // Validate required fields
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Name and deadline are required",
                data: {}
            });
        }

        Task.findById(req.params.id, function (err, task) {
            if (err) {
                return res.status(500).json({
                    message: "Error retrieving task",
                    data: {}
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Task not found",
                    data: {}
                });
            }

            // Store old values for two-way reference management
            var oldAssignedUser = task.assignedUser;
            var oldCompleted = task.completed;

            // Replace task fields
            task.name = req.body.name;
            task.description = req.body.description || "";
            task.deadline = req.body.deadline;
            task.completed = req.body.completed !== undefined ? req.body.completed : false;
            task.assignedUser = req.body.assignedUser || "";
            task.assignedUserName = req.body.assignedUserName || "unassigned";

            task.save(function (err, updatedTask) {
                if (err) {
                    return res.status(500).json({
                        message: "Error updating task",
                        data: {}
                    });
                }

                // Update two-way references
                var taskIdStr = updatedTask._id.toString();

                // If the assigned user changed or task completed status changed
                if (oldAssignedUser !== updatedTask.assignedUser || oldCompleted !== updatedTask.completed) {
                    
                    // Remove task from old user's pendingTasks if:
                    // 1. The assigned user changed, OR
                    // 2. The task was marked as completed
                    if (oldAssignedUser && oldAssignedUser !== "") {
                        User.findById(oldAssignedUser, function (err, user) {
                            if (!err && user) {
                                var index = user.pendingTasks.indexOf(taskIdStr);
                                if (index > -1) {
                                    user.pendingTasks.splice(index, 1);
                                    user.save(function (err) {
                                        if (err) {
                                            console.error("Error removing task from old user:", err);
                                        }
                                    });
                                }
                            }
                        });
                    }

                    // Add task to new user's pendingTasks ONLY if:
                    // 1. Task is assigned to a user (not empty), AND
                    // 2. Task is NOT completed, AND
                    // 3. The assigned user actually changed (don't re-add if just marked completed)
                    if (updatedTask.assignedUser && 
                        updatedTask.assignedUser !== "" && 
                        !updatedTask.completed && 
                        oldAssignedUser !== updatedTask.assignedUser) {
                        User.findById(updatedTask.assignedUser, function (err, user) {
                            if (!err && user) {
                                if (user.pendingTasks.indexOf(taskIdStr) === -1) {
                                    user.pendingTasks.push(taskIdStr);
                                    user.save(function (err) {
                                        if (err) {
                                            console.error("Error adding task to new user:", err);
                                        }
                                    });
                                }
                            }
                        });
                    }
                }

                return res.status(200).json({
                    message: "Task updated",
                    data: updatedTask
                });
            });
        });
    });

    // DELETE /api/tasks/:id - Delete a task
    taskRoute.delete(function (req, res) {
        Task.findById(req.params.id, function (err, task) {
            if (err) {
                return res.status(500).json({
                    message: "Error retrieving task",
                    data: {}
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Task not found",
                    data: {}
                });
            }

            var assignedUser = task.assignedUser;
            var taskIdStr = task._id.toString();

            task.remove(function (err) {
                if (err) {
                    return res.status(500).json({
                        message: "Error deleting task",
                        data: {}
                    });
                }

                // Remove task from assigned user's pendingTasks
                if (assignedUser && assignedUser !== "") {
                    User.findById(assignedUser, function (err, user) {
                        if (!err && user) {
                            var index = user.pendingTasks.indexOf(taskIdStr);
                            if (index > -1) {
                                user.pendingTasks.splice(index, 1);
                                user.save(function (err) {
                                    if (err) {
                                        console.error("Error removing task from user:", err);
                                    }
                                });
                            }
                        }
                    });
                }

                return res.status(200).json({
                    message: "Task deleted",
                    data: task
                });
            });
        });
    });

    return router;
};
